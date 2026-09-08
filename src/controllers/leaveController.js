// src/controllers/leaveController.js
const fs = require("fs");
const knex = require("../db/db");
const upload = require("../middleware/leaveAttachmentUpload");
const { hasAnyRole } = require("../middleware/authMiddleware");
const { sendLeaveNotification } = require("../utils/sendLeaveNotification");
const {
  sendLeaveStatusNotification,
} = require("../utils/sendLeaveStatusNotification");
const { generateAutoNumber } = require("../utils/generateAutoNumber");
const {
  assignLeaveBalancesForEmployee,
  backfillLeaveBalancesForLeaveType,
  reconcileMissingLeaveBalances,
  getLeaveCycleForDate,
  isLeaveTypeEligibleForEmployee,
} = require("../services/leaveBalanceService");
const { validateLeavePolicy } = require("../services/companyPolicyService");

const normalizeWorkflowText = (value) =>
  String(value || "")
    .toLowerCase()
    .trim();

const isCanonicalUnpaidLeaveType = (leaveType) => {
  const name = normalizeWorkflowText(leaveType?.name);
  const isPaid = leaveType?.is_paid === true || Number(leaveType?.is_paid) === 1;
  return !isPaid && [
    "unpaid leave",
    "loss of pay",
    "lop",
  ].includes(name);
};

const isProbationEmployee = (employee) =>
  normalizeWorkflowText(employee?.employment_type).includes("probation");

const resolveWorkflowRole = (user = {}) => {
  const normalizedRole = normalizeWorkflowText(user.role);
  const normalizedType = normalizeWorkflowText(user.type);

  if (normalizedRole === "ceo") return "ceo";
  if (normalizedRole === "admin" || normalizedType === "admin") return "admin";
  if (normalizedRole === "hr") return "hr";
  if (normalizedRole === "manager") return "manager";
  return "employee";
};

const resolveEmployeeProfile = async (req, companyId) => {
  if (req.user?.employee_id) {
    const byMappedId = await knex("employees")
      .where({ id: Number(req.user.employee_id), company_id: companyId })
      .first();
    if (byMappedId) return byMappedId;
  }

  if (normalizeWorkflowText(req.user?.type) === "employee") {
    const byId = await knex("employees")
      .where({ id: Number(req.user?.id), company_id: companyId })
      .first();
    if (byId) return byId;
  }

  if (req.user?.email) {
    const byEmail = await knex("employees")
      .where("company_id", companyId)
      .whereRaw("LOWER(email) = ?", [
        String(req.user.email).toLowerCase().trim(),
      ])
      .first();
    if (byEmail) return byEmail;
  }

  // Admin/user IDs are not employee IDs and can collide with an unrelated
  // employee record. They must be mapped through employee_id or email above.
  return null;
};

const parseCsv = (value) =>
  String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

const parseLeaveDate = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return null;
  const [year, month, day] = String(value).split("-").map(Number);
  const parsed = new Date(year, month - 1, day);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null;
  }
  parsed.setHours(0, 0, 0, 0);
  return parsed;
};

const getLeaveApplicationDateBounds = () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const minDate = new Date(today);
  minDate.setMonth(minDate.getMonth() - 1);

  const maxDate = new Date(today);
  maxDate.setMonth(maxDate.getMonth() + 1);

  return { minDate, maxDate };
};

const assertLeaveDateWithinApplicationWindow = (parsedDate, fieldLabel) => {
  const { minDate, maxDate } = getLeaveApplicationDateBounds();
  if (parsedDate < minDate || parsedDate > maxDate) {
    return `${fieldLabel} must be within the previous 1 month or next 1 month`;
  }
  return null;
};

const normalizeHalfDaySession = (value) => {
  const session = String(value || "")
    .toLowerCase()
    .trim();
  return ["first_half", "second_half"].includes(session) ? session : null;
};

const toLeaveNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const getReservedLeaveUsage = async ({
  trx = knex,
  companyId,
  employeeId,
  leaveTypeId,
  statuses = ["pending", "approved"],
  start,
  end,
  excludeApplicationId = null,
}) => {
  const query = trx("leave_applications")
    .where({
      company_id: companyId,
      employee_id: employeeId,
      leave_type_id: leaveTypeId,
    })
    .whereIn("status", statuses)
    .where("from_date", ">=", start)
    .where("from_date", "<=", end);

  if (excludeApplicationId) {
    query.whereNot({ id: excludeApplicationId });
  }

  const row = await query.sum({ used: "days" }).first();
  return toLeaveNumber(row?.used);
};

const getSelectedApproverEmails = async (companyId, body = {}) => {
  const selectedEntries = parseCsv(body.reporting_manager_id);
  const selectedUserIds = selectedEntries
    .filter((id) => id.startsWith("user:"))
    .map((id) => Number(id.replace("user:", "")))
    .filter(Boolean);
  const selectedIds = selectedEntries
    .filter((id) => !id.startsWith("user:"))
    .map((id) => Number(id))
    .filter(Boolean);

  const emails = [];

  if (selectedIds.length > 0) {
    const rows = await knex("employees")
      .where("company_id", companyId)
      .whereIn("id", selectedIds)
      .whereRaw('LOWER(TRIM(COALESCE(status, ""))) = ?', ["active"])
      .select("email");

    emails.push(...rows.map((row) => row.email).filter(Boolean));
  }

  if (selectedUserIds.length > 0) {
    const rows = await knex("users")
      .where("company_id", companyId)
      .whereIn("id", selectedUserIds)
      .select("email");

    emails.push(...rows.map((row) => row.email).filter(Boolean));
  }

  if (emails.length > 0) {
    return [...new Set(emails)];
  }

  return [...new Set(parseCsv(body.reporting_manager_email))];
};

// approved_by in leave_applications references employees.id.
// Resolve from auth context where req.user.id may be users.id for admin tokens.
const resolveApproverEmployeeId = async (req, companyId) => {
  if (!companyId) return null;

  const directEmployee = await knex("employees")
    .where({ id: Number(req.user?.id), company_id: companyId })
    .first();
  if (directEmployee) return Number(directEmployee.id);

  if (req.user?.email) {
    const byEmail = await knex("employees")
      .where("company_id", companyId)
      .whereRaw("LOWER(email) = ?", [
        String(req.user.email).toLowerCase().trim(),
      ])
      .first();
    if (byEmail) return Number(byEmail.id);
  }

  return null;
};

// Auto generate IDs per company
const generateId = async (table, prefix, companyId) => {
  const last = await knex(table)
    .where({ company_id: companyId })
    .orderBy("id", "desc")
    .first();

  if (!last) return `${prefix}001`;

  const columnName =
    table === "leave_applications"
      ? "application_id"
      : `${prefix.toLowerCase()}_id`;
  const num = parseInt(last[columnName].replace(prefix, "")) + 1;
  return `${prefix}${String(num).padStart(3, "0")}`;
};

// Initialize leave balance for new employee or new year
const initializeLeaveBalance = async (
  employeeId,
  companyId,
  year = new Date().getFullYear(),
) => {
  try {
    const result = await assignLeaveBalancesForEmployee(employeeId, companyId, {
      year,
    });
    if (!result.success) {
      console.warn(
        `Leave balance initialization skipped for employee ${employeeId}: ${result.reason}`,
      );
    }
    return result;
  } catch (error) {
    console.error("Error initializing leave balance:", error);
    return { success: false, inserted: 0, reason: "error" };
  }
};

// Apply Leave (company scoped)
// const applyLeave = async (req, res) => {
//   upload(req, res, async (err) => {
//     if (err) {
//       return res.status(400).json({ message: err.message });
//     }

//     const companyId = req.user.company_id;
//     if (!companyId) {
//       if (req.file) fs.unlinkSync(req.file.path);
//       return res.status(400).json({ message: 'You are not assigned to any company' });
//     }

//     const employeeId = req.user.id;

//     try {
//       // ===============================
//       // GET EMPLOYEE DETAILS
//       // ===============================
//       const employee = await knex('employees')
//         .where({ id: employeeId, company_id: companyId })
//         .select('id', 'first_name', 'last_name', 'email', 'department_id')
//         .first();

//       if (!employee) {
//         if (req.file) fs.unlinkSync(req.file.path);
//         return res.status(404).json({ message: 'Employee not found or access denied' });
//       }

//       const employeeName = `${employee.first_name} ${employee.last_name || ''}`.trim();

//       const { leave_type_id, from_date, to_date, reason } = req.body;

//       if (!leave_type_id || !from_date || !to_date || !reason) {
//         if (req.file) fs.unlinkSync(req.file.path);
//         return res.status(400).json({ message: 'All fields required' });
//       }

//       // ===============================
//       // CALCULATE LEAVE DAYS
//       // ===============================
//       const days =
//         Math.ceil((new Date(to_date) - new Date(from_date)) / (1000 * 60 * 60 * 24)) + 1;

//       // ===============================
//       // CHECK LEAVE BALANCE
//       // ===============================
//       const currentYear = new Date().getFullYear();

//       const balance = await knex('leave_balances')
//         .where({
//           employee_id: employeeId,
//           leave_type_id,
//           year: currentYear
//         })
//         .first();

//       if (!balance || balance.available < days) {
//         if (req.file) fs.unlinkSync(req.file.path);
//         return res.status(400).json({ message: 'Insufficient leave balance' });
//       }

//       // ===============================
//       // FILE ATTACHMENT
//       // ===============================
//       let attachmentPath = null;
//       if (req.file) {
//         attachmentPath = `/uploads/leave-attachments/${req.file.filename}`;
//       }

//       // ===============================
//       // CREATE LEAVE APPLICATION
//       // ===============================
//       const application_id = await generateAutoNumber(companyId, 'leave');

//       const leaveType = await knex('leave_types')
//         .where({ id: leave_type_id })
//         .first();

//       const [newId] = await knex('leave_applications').insert({
//         company_id: companyId,
//         application_id,
//         employee_id: employeeId,
//         employee_name: employeeName,
//         leave_type_id,
//         leave_type_name: leaveType.name,
//         from_date,
//         to_date,
//         days,
//         reason,
//         attachment_path: attachmentPath,
//         status: 'pending'
//       });

//       const newApplication = await knex('leave_applications')
//         .where({ id: newId })
//         .first();

//       // ===============================
//       // 📧 EMAIL NOTIFICATION LOGIC
//       // ===============================
//       const toEmails = [];

//       // 1️⃣ SAME DEPARTMENT MANAGER
//       if (employee.department_id) {
//         const departmentManager = await knex('employees')
//           .where({
//             company_id: companyId,
//             department_id: employee.department_id,
//             role: 'manager',
//             status: 'Active'
//           })
//           .select('email')
//           .first();

//         if (departmentManager?.email) {
//           toEmails.push(departmentManager.email);
//         }
//       }

//       // 2️⃣ COMPANY HR (ONLY ONE)
//       if (toEmails.length === 0) {
//         const companyHR = await knex('employees')
//           .where({
//             company_id: companyId,
//             role: 'hr',
//             status: 'Active'
//           })
//           .select('email')
//           .first();

//         if (companyHR?.email) {
//           toEmails.push(companyHR.email);
//         }
//       }

//       // 3️⃣ DEFAULT HR
//       if (toEmails.length === 0) {
//         toEmails.push(process.env.DEFAULT_HR_EMAIL || 'hr@company.com');
//       }

//       // ===============================
//       // SEND EMAIL
//       // ===============================
//       if (toEmails.length > 0) {
//         await sendLeaveNotification(
//           toEmails,
//           newApplication,
//           {
//             employee_name: employeeName,
//             employee_email: employee.email
//           },
//           leaveType
//         );
//       }

//       // ===============================
//       // RESPONSE
//       // ===============================
//       res.status(201).json({
//         success: true,
//         message: 'Leave application submitted successfully!',
//         application: {
//           ...newApplication,
//           attachment_url: attachmentPath
//             ? `${process.env.BASE_URL}${attachmentPath}`
//             : null
//         }
//       });

//     } catch (error) {
//       if (req.file) fs.unlinkSync(req.file.path);
//       console.error('Apply leave error:', error);
//       res.status(500).json({ message: 'Server error' });
//     }
//   });
// };

const applyLeave = async (req, res) => {
  upload(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ message: err.message });
    }

    const companyId = req.user.company_id;
    if (!companyId) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res
        .status(400)
        .json({ message: "You are not assigned to any company" });
    }

    const userRole = req.user.role; // 🔥 FROM TOKEN

    try {
      // ===============================
      // GET EMPLOYEE DETAILS
      // ===============================
      const employee = await resolveEmployeeProfile(req, companyId);

      if (!employee) {
        if (req.file) fs.unlinkSync(req.file.path);
        return res
          .status(404)
          .json({ message: "Employee not found or access denied" });
      }

      const employeeId = employee.id;
      const employeeName =
        `${employee.first_name} ${employee.last_name || ""}`.trim();

      let { leave_type_id } = req.body;
      const { from_date, to_date, reason } = req.body;
      const leaveDuration = String(
        req.body.leave_duration || req.body.leaveDuration || "full_day",
      )
        .toLowerCase()
        .trim();
      const isHalfDay = leaveDuration === "half_day";
      const halfDaySession = isHalfDay
        ? normalizeHalfDaySession(
            req.body.half_day_session || req.body.halfDaySession,
          )
        : null;

      if (!leave_type_id || !from_date || !to_date || !reason) {
        if (req.file) fs.unlinkSync(req.file.path);
        return res.status(400).json({ message: "All fields required" });
      }

      const parsedFromDate = parseLeaveDate(from_date);
      const parsedToDate = parseLeaveDate(to_date);

      if (!parsedFromDate || !parsedToDate) {
        if (req.file) fs.unlinkSync(req.file.path);
        return res
          .status(400)
          .json({ message: "Please provide valid leave dates" });
      }

      if (parsedToDate < parsedFromDate) {
        if (req.file) fs.unlinkSync(req.file.path);
        return res
          .status(400)
          .json({ message: "To date cannot be earlier than from date" });
      }

      const fromDateWindowError = assertLeaveDateWithinApplicationWindow(
        parsedFromDate,
        "From date",
      );
      if (fromDateWindowError) {
        if (req.file) fs.unlinkSync(req.file.path);
        return res.status(400).json({ message: fromDateWindowError });
      }

      const toDateWindowError = assertLeaveDateWithinApplicationWindow(
        parsedToDate,
        "To date",
      );
      if (toDateWindowError) {
        if (req.file) fs.unlinkSync(req.file.path);
        return res.status(400).json({ message: toDateWindowError });
      }

      if (isHalfDay && !halfDaySession) {
        if (req.file) fs.unlinkSync(req.file.path);
        return res.status(400).json({
          message: "Please select first half or second half for half-day leave",
        });
      }

      if (isHalfDay && from_date !== to_date) {
        if (req.file) fs.unlinkSync(req.file.path);
        return res
          .status(400)
          .json({ message: "Half-day leave must be for a single date" });
      }

      // ===============================
      // CALCULATE LEAVE DAYS
      // ===============================
      const days = isHalfDay
        ? 0.5
        : Math.floor((parsedToDate - parsedFromDate) / (1000 * 60 * 60 * 24)) +
          1;

      // ===============================
      // CHECK LEAVE BALANCE / PROBATION (LOP) HANDLING
      // ===============================
      const leaveCycle = await getLeaveCycleForDate(knex, companyId, from_date);
      const currentYear = leaveCycle.year;

      // Get the requested leave type (company scoped)
      let leaveType = await knex("leave_types")
        .where({ id: leave_type_id, company_id: companyId })
        .first();

      if (!leaveType) {
        if (req.file) fs.unlinkSync(req.file.path);
        return res.status(400).json({ message: "Invalid leave type" });
      }

      // Probation employees may request only full-day Unpaid Leave/LOP.
      // Never silently convert a paid or half-day request into another type.
      if (isProbationEmployee(employee)) {
        if (isHalfDay) {
          if (req.file) fs.unlinkSync(req.file.path);
          return res.status(400).json({
            message: "Employees on probation can apply only for full-day Unpaid Leave",
          });
        }
        if (!isCanonicalUnpaidLeaveType(leaveType)) {
          if (req.file) fs.unlinkSync(req.file.path);
          return res.status(400).json({
            message: "Employees on probation can apply only for Unpaid Leave",
          });
        }
      }

      // If leave type is paid, ensure balance exists and is sufficient
      let balance = null;
      if (leaveType && leaveType.is_paid) {
        balance = await knex("leave_balances")
          .where({
            company_id: companyId,
            employee_id: employeeId,
            leave_type_id,
            year: currentYear,
          })
          .first();

        if (!balance) {
          if (req.file) fs.unlinkSync(req.file.path);
          return res
            .status(400)
            .json({ message: "Leave balance not found for current leave cycle" });
        }

        const totalBalance = toLeaveNumber(balance.total ?? balance.opening_balance);
        const reservedUsage = await getReservedLeaveUsage({
          companyId,
          employeeId,
          leaveTypeId: leave_type_id,
          start: leaveCycle.start,
          end: leaveCycle.end,
        });
        const availableAfterReserved = totalBalance - reservedUsage;

        if (availableAfterReserved < days) {
          if (req.file) fs.unlinkSync(req.file.path);
          return res.status(400).json({
            message: "Insufficient leave balance",
            available_days: Math.max(availableAfterReserved, 0),
            requested_days: days,
            leave_cycle: `${leaveCycle.start} to ${leaveCycle.end}`,
          });
        }
      }

      const leavePolicyError = await validateLeavePolicy({
        companyId,
        employee,
        leaveType,
        requestedDays: days,
        fromDate: from_date,
      });
      if (leavePolicyError) {
        if (req.file) fs.unlinkSync(req.file.path);
        return res.status(400).json({ message: leavePolicyError });
      }

      // ===============================
      // FILE ATTACHMENT
      // ===============================
      let attachmentPath = null;
      if (req.file) {
        attachmentPath = `/uploads/leave-attachments/company_${companyId}/${req.file.filename}`;
      }

      // ===============================
      // CREATE LEAVE APPLICATION
      // ===============================
      // Generate application ID (APP001 format)
      const lastApplication = await knex("leave_applications")
        .where({ company_id: companyId })
        .orderBy("id", "desc")
        .first();

      let nextNumber = 1;
      if (lastApplication && lastApplication.application_id) {
        const match = lastApplication.application_id.match(/APP(\d+)/);
        if (match) {
          nextNumber = parseInt(match[1]) + 1;
        }
      }

      const application_id = `APP${nextNumber.toString().padStart(3, "0")}`;

      // ensure leaveType is available for notification later
      if (!leaveType) {
        leaveType = await knex("leave_types")
          .where({ id: leave_type_id })
          .first();
      }

      const applicationPayload = {
        company_id: companyId,
        application_id,
        employee_id: employeeId,
        employee_name: employeeName,
        leave_type_id,
        leave_type_name: leaveType.name,
        from_date,
        to_date,
        days,
        reason,
        attachment_path: attachmentPath,
        status: "pending",
      };

      if (await knex.schema.hasColumn("leave_applications", "half_day_session")) {
        applicationPayload.half_day_session = halfDaySession;
      }

      const [newId] = await knex("leave_applications").insert(applicationPayload);

      const newApplication = await knex("leave_applications")
        .where({ id: newId })
        .first();

      // ===============================
      // 📧 FINAL EMAIL LOGIC — collect HR and include admins when HR exists
      // Use a Set to dedupe and scope queries by company
      // ===============================
      const recipientSet = new Set();

      console.log("================ APPLY LEAVE EMAIL DEBUG ================");
      console.log("Applicant ID:", employee.id);
      console.log("Applicant Role (token):", userRole);
      console.log("Applicant Department:", employee.department_id);
      console.log("Applicant Designation:", employee.designation_id);

      // Get Manager Designation
      const managerDesignation = await knex("designations")
        .whereRaw("LOWER(name) = ?", ["manager"])
        .andWhere({ company_id: companyId })
        .first();

      // Get HR Department (if any)
      const hrDepartment = await knex("departments")
        .whereRaw("LOWER(name) = ?", ["hr"])
        .andWhere({ company_id: companyId })
        .first();

      console.log("Manager Designation:", managerDesignation);
      console.log("HR Department:", hrDepartment);

      // Helper: fetch all HR emails for company (may be multiple)
      const fetchCompanyHrEmails = async () => {
        const hrs = await knex("employees")
          .whereRaw("TRIM(LOWER(role)) = ?", ["hr"])
          .andWhere({ company_id: companyId, status: "Active" })
          .select("email");
        return hrs.map((h) => h.email).filter(Boolean);
      };

      // Helper: fetch all admin emails for company
      const fetchAdminEmails = async () => {
        const admins = await knex("employees")
          .whereRaw("TRIM(LOWER(role)) = ?", ["admin"])
          .andWhere({ company_id: companyId, status: "Active" })
          .select("email");
        return admins.map((a) => a.email).filter(Boolean);
      };

      // 1️⃣ EMPLOYEE → Dept Manager + HR (if present) + Admins (if HR present)
      if (resolveWorkflowRole(req.user) === "employee") {
        if (managerDesignation && employee.department_id) {
          const deptManager = await knex("employees")
            .where({
              company_id: companyId,
              department_id: employee.department_id,
              designation_id: managerDesignation.id,
              status: "Active",
            })
            .select("email")
            .first();

          if (deptManager?.email) recipientSet.add(deptManager.email);
        }

        const hrEmails = await fetchCompanyHrEmails();
        hrEmails.forEach((e) => recipientSet.add(e));

        if (hrEmails.length > 0) {
          const adminEmails = await fetchAdminEmails();
          adminEmails.forEach((e) => recipientSet.add(e));
        }
      }

      // 2️⃣ MANAGER → HR (+ admins if HR exists)
      else if (resolveWorkflowRole(req.user) === "manager") {
        const hrEmails = await fetchCompanyHrEmails();
        hrEmails.forEach((e) => recipientSet.add(e));

        if (hrEmails.length > 0) {
          const adminEmails = await fetchAdminEmails();
          adminEmails.forEach((e) => recipientSet.add(e));
        }
      }

      // 3️⃣ HR → ADMIN (keep existing behavior but allow multiple admins)
      else if (resolveWorkflowRole(req.user) === "hr") {
        const adminEmails = await fetchAdminEmails();
        adminEmails.forEach((e) => recipientSet.add(e));
      }

      // 4️⃣ ADMIN → HR (+ include admins too so they get a copy)
      else if (resolveWorkflowRole(req.user) === "admin") {
        const hrEmails = await fetchCompanyHrEmails();
        hrEmails.forEach((e) => recipientSet.add(e));

        // include admins as well so admin group receives notification
        const adminEmails = await fetchAdminEmails();
        adminEmails.forEach((e) => recipientSet.add(e));
      }

      const rebuiltRecipients = [];
      const workflowRole = resolveWorkflowRole(req.user);

      if (workflowRole === "employee") {
        if (managerDesignation && employee.department_id) {
          const deptManager = await knex("employees")
            .where({
              company_id: companyId,
              department_id: employee.department_id,
              designation_id: managerDesignation.id,
              status: "Active",
            })
            .select("email")
            .first();

          if (deptManager?.email) rebuiltRecipients.push(deptManager.email);
        }

        const [adminEmails, ceoEmails] = await Promise.all([
          fetchAdminEmails(),
          knex("employees")
            .whereRaw("TRIM(LOWER(role)) = ?", ["ceo"])
            .andWhere({ company_id: companyId, status: "Active" })
            .select("email")
            .then((rows) => rows.map((row) => row.email).filter(Boolean)),
        ]);

        [...adminEmails, ...ceoEmails].forEach((email) => {
          if (email && !rebuiltRecipients.includes(email)) {
            rebuiltRecipients.push(email);
          }
        });
      } else if (["manager", "hr", "admin", "ceo"].includes(workflowRole)) {
        const ceoEmails = await knex("employees")
          .whereRaw("TRIM(LOWER(role)) = ?", ["ceo"])
          .andWhere({ company_id: companyId, status: "Active" })
          .select("email");

        ceoEmails
          .map((row) => row.email)
          .filter(Boolean)
          .forEach((email) => {
            if (!rebuiltRecipients.includes(email)) {
              rebuiltRecipients.push(email);
            }
          });
      }

      if (rebuiltRecipients.length > 0) {
        recipientSet.clear();
        rebuiltRecipients.forEach((email) => recipientSet.add(email));
      }

      const selectedApproverEmails = await getSelectedApproverEmails(
        companyId,
        req.body,
      );
      if (selectedApproverEmails.length > 0) {
        recipientSet.clear();
        selectedApproverEmails.forEach((email) => recipientSet.add(email));
      }

      // FALLBACK
      let toEmails = Array.from(recipientSet);
      if (toEmails.length === 0) {
        const fallback = process.env.DEFAULT_HR_EMAIL || "hr@company.com";
        console.log("⚠️ Using FALLBACK EMAIL:", fallback);
        toEmails = [fallback];
      }

      console.log("📧 FINAL Leave notification recipients:", toEmails);
      console.log("=========================================================");

      // SEND EMAIL
      try {
        await sendLeaveNotification(
          toEmails,
          newApplication,
          {
            employee_name: employeeName,
            employee_email: employee.email,
          },
          leaveType,
        );
      } catch (emailError) {
        console.error("Leave notification email failed:", emailError);
      }

      // ===============================
      // RESPONSE
      // ===============================
      res.status(201).json({
        success: true,
        message: "Leave application submitted successfully!",
        application: {
          ...newApplication,
          attachment_url: attachmentPath
            ? `${process.env.BASE_URL}${attachmentPath}`
            : null,
        },
      });
    } catch (error) {
      if (req.file) fs.unlinkSync(req.file.path);
      console.error("Apply leave error:", error);
      res.status(500).json({ message: "Server error" });
    }
  });
};

const getLeaveApplications = async (req, res) => {
  const companyId = req.user.company_id;
  if (!companyId) {
    return res
      .status(400)
      .json({ message: "You are not assigned to any company" });
  }

  try {
    let query = knex("leave_applications")
      // The foreign-key record is the source of truth for the leave type.  The
      // application name is kept as a historical snapshot, so it may be wrong
      // on records created by an older client.
      .leftJoin("leave_types as application_leave_type", function () {
        this.on(
          "leave_applications.leave_type_id",
          "=",
          "application_leave_type.id",
        ).andOn(
          "leave_applications.company_id",
          "=",
          "application_leave_type.company_id",
        );
      })
      .leftJoin(
        "employees as approver",
        "leave_applications.approved_by",
        "approver.id",
      )
      .where("leave_applications.company_id", companyId)
      .select(
        "leave_applications.*",
        "application_leave_type.name as configured_leave_type_name",
        "approver.first_name as approved_by_first_name",
        "approver.last_name as approved_by_last_name",
      )
      .orderBy("leave_applications.created_at", "desc");

    if (
      hasAnyRole(req.user, ["employee"]) &&
      !hasAnyRole(req.user, ["manager", "hr", "admin", "ceo", "superadmin"])
    ) {
      query = query.where("leave_applications.employee_id", req.user.id);
    } else if (hasAnyRole(req.user, ["manager"])) {
      query = query.where((builder) => {
        builder
          .where("leave_applications.employee_id", req.user.id)
          .orWhereExists(function () {
            this.select(1)
              .from("employees as team")
              .where("team.company_id", companyId)
              .whereRaw('manager_name = CONCAT(?, " ", COALESCE(?, ""))', [
                req.user.first_name || "",
                req.user.last_name || "",
              ])
              .whereRaw("team.id = leave_applications.employee_id");
          });
      });
    }
    // Admin / HR → all applications

    const applications = await query;

    const enriched = applications.map((app) => ({
      ...app,
      approved_by_name: app.approved_by_first_name
        ? `${app.approved_by_first_name} ${app.approved_by_last_name || ""}`.trim()
        : null,
      attachment_url: app.attachment_path || null,
    }));

    res.json({
      success: true,
      count: enriched.length,
      applications: enriched,
    });
  } catch (error) {
    console.error("Get leave applications error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// Approve/Reject Leave (HR/Admin only - company scoped)
const updateLeaveStatus = async (req, res) => {
  const companyId = req.user.company_id;

  if (!companyId) {
    return res
      .status(400)
      .json({ message: "You are not assigned to any company" });
  }

  const { id } = req.params;
  const { status, remarks } = req.body;

  if (!["approved", "rejected"].includes(status)) {
    return res.status(400).json({ message: "Invalid status" });
  }

  try {
    // ===============================
    // GET LEAVE APPLICATION
    // ===============================
    const application = await knex("leave_applications")
      .where({ id, company_id: companyId })
      .first();

    if (!application)
      return res.status(404).json({ message: "Application not found" });
    if (application.status !== "pending")
      return res.status(400).json({ message: "Application already processed" });

    // ===============================
    // GET APPLICANT EMPLOYEE
    // ===============================
    const applicant = await knex("employees")
      .where({ id: application.employee_id, company_id: companyId })
      .select("id", "first_name", "last_name", "email", "department_id")
      .first();

    if (!applicant)
      return res.status(404).json({ message: "Employee not found" });

    // ===============================
    // AUTHORIZATION CHECK
    // ===============================
    let isAuthorized = false;
    if (hasAnyRole(req.user, ["hr", "admin", "ceo", "superadmin"]))
      isAuthorized = true;
    if (
      !isAuthorized &&
      hasAnyRole(req.user, ["manager"]) &&
      applicant.department_id
    ) {
      const manager = await knex("employees")
        .where({
          id: req.user.id,
          company_id: companyId,
          department_id: applicant.department_id,
          role: "manager",
        })
        .first();
      if (manager) isAuthorized = true;
    }
    if (!isAuthorized)
      return res.status(403).json({ message: "Not authorized" });

    // ===============================
    // UPDATE LEAVE BALANCE (IF APPROVED) - skip for unpaid leave (LOP)
    // ===============================
    if (status === "approved") {
      const leaveCycle = await getLeaveCycleForDate(
        knex,
        companyId,
        application.from_date,
      );
      const applicationYear = leaveCycle.year;

      // fetch leave type to determine if it's paid
      const applicationLeaveType = await knex("leave_types")
        .where({ id: application.leave_type_id, company_id: companyId })
        .first();

      // If leave type is paid, update balances as before
      if (applicationLeaveType && applicationLeaveType.is_paid) {
        const balance = await knex("leave_balances")
          .where({
            company_id: companyId,
            employee_id: application.employee_id,
            leave_type_id: application.leave_type_id,
            year: applicationYear,
          })
          .first();

        if (!balance)
          return res.status(400).json({ message: "Leave balance not found" });

        const total = toLeaveNumber(balance.total ?? balance.opening_balance);
        const approvedUsage = await getReservedLeaveUsage({
          companyId,
          employeeId: application.employee_id,
          leaveTypeId: application.leave_type_id,
          statuses: ["approved"],
          start: leaveCycle.start,
          end: leaveCycle.end,
          excludeApplicationId: application.id,
        });

        const applicationDays = toLeaveNumber(application.days);
        const newAvailed = approvedUsage + applicationDays;
        const newAvailable = total - newAvailed;

        if (newAvailable < 0) {
          return res.status(400).json({
            message: "Insufficient leave balance",
            leave_type_id: application.leave_type_id,
            requested_days: applicationDays,
            available_days: Math.max(total - approvedUsage, 0),
          });
        }

        await knex("leave_balances").where({ id: balance.id }).update({
          availed: newAvailed,
          available: newAvailable,
        });
      } else {
        // unpaid leave (loss of pay) — do not touch leave balances
      }
    }

    // ===============================
    // UPDATE LEAVE APPLICATION
    // ===============================
    const approverEmployeeId = await resolveApproverEmployeeId(req, companyId);
    const updatePayload = {
      status,
      approved_by: approverEmployeeId,
    };

    if (await knex.schema.hasColumn("leave_applications", "approved_at")) {
      updatePayload.approved_at = knex.fn.now();
    }

    if (await knex.schema.hasColumn("leave_applications", "remarks")) {
      updatePayload.remarks = remarks || null;
    }

    await knex("leave_applications")
      .where({ id, company_id: companyId })
      .update(updatePayload);

    // ===============================
    // SEND EMAIL TO EMPLOYEE
    // ===============================
    const employeeFullName =
      `${applicant.first_name} ${applicant.last_name || ""}`.trim();
    try {
      await sendLeaveStatusNotification(
        application,
        { employee_name: employeeFullName, employee_email: applicant.email },
        status,
      );
    } catch (emailError) {
      console.error("Leave status notification email failed:", emailError);
    }

    res.json({ success: true, message: `Leave ${status} successfully!` });
  } catch (error) {
    console.error("Update leave status error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// Get Leave Types (company scoped)
const getLeaveTypes = async (req, res) => {
  const companyId = req.user.company_id;
  if (!companyId) {
    return res
      .status(400)
      .json({ message: "You are not assigned to any company" });
  }

  try {
    const employee = await resolveEmployeeProfile(req, companyId);
    const probationRestricted =
      normalizeWorkflowText(req.user?.type) === "employee" &&
      isProbationEmployee(employee);

    const typesQuery = knex("leave_types")
      .where({ company_id: companyId, status: "active" })
      .orderBy("name");

    if (probationRestricted) {
      typesQuery
        .andWhere({ is_paid: false })
        .whereRaw("LOWER(TRIM(name)) IN (?, ?, ?)", [
          "unpaid leave",
          "loss of pay",
          "lop",
        ]);
    }

    let types = await typesQuery;
    if (normalizeWorkflowText(req.user?.type) === "employee" && employee) {
      types = types.filter((leaveType) =>
        isLeaveTypeEligibleForEmployee(leaveType, employee),
      );
    }

    res.json({
      success: true,
      leaveTypes: types,
      probationRestricted,
    });
  } catch (error) {
    console.error("Get leave types error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// const getLeaveBalance = async (req, res) => {
//   const companyId = req.user.company_id;
//   if (!companyId) {
//     return res.status(400).json({ message: 'You are not assigned to any company' });
//   }

//   const employeeId = req.user.id;
//   const role = req.user.role;
//   const currentYear = new Date().getFullYear();

//   try {
//     let rows = await knex('leave_balances')
//       .leftJoin('leave_types', 'leave_balances.leave_type_id', 'leave_types.id')
//       .leftJoin('employees', 'leave_balances.employee_id', 'employees.id')
//       .where('leave_balances.year', currentYear)
//       .select(
//         'leave_balances.id',
//         'leave_balances.employee_id',
//         knex.raw("CONCAT(employees.first_name, ' ', employees.last_name) as employee_name"),
//         'employees.role as employee_role',
//         'leave_balances.company_id',
//         'leave_balances.leave_type_id',
//         'leave_balances.opening_balance',
//         'leave_balances.availed',
//         'leave_balances.available',
//         'leave_balances.year',
//         'leave_types.name as leave_type_name'
//       );

//     if (role === 'employee') {
//       rows = rows.filter(row => row.employee_id === employeeId);
//     } else if (['hr', 'manager', 'finance','admin'].includes(role)) {
//       rows = rows.filter(row => row.company_id === companyId);
//     } else {
//       return res.status(403).json({ message: 'Unauthorized role' });
//     }

//     // Group by employee
//     const balances = [];
//     const map = new Map();

//     for (const row of rows) {
//       if (!map.has(row.employee_id)) {
//         map.set(row.employee_id, {
//           employee_id: row.employee_id,
//           employee_name: row.employee_name,
//           employee_role: row.employee_role,
//           company_id: row.company_id,
//           leaves: []
//         });
//       }
//       map.get(row.employee_id).leaves.push({
//         leave_type_name: row.leave_type_name,
//         opening_balance: row.opening_balance,
//         availed: row.availed,
//         available: row.available
//       });
//     }

//     balances.push(...map.values());

//     res.json({
//       success: true,
//       balances
//     });
//   } catch (error) {
//     console.error('Get leave balance error:', error);
//     res.status(500).json({ message: 'Server error' });
//   }
// };

// const getLeaveBalance = async (req, res) => {
//   try {
//     const { id, company_id, role, department_id } = req.user;
//     const year = new Date().getFullYear();

//     let query = knex('leave_balances as lb')
//       .join('leave_types as lt', 'lb.leave_type_id', 'lt.id')
//       .join('employees as emp', 'lb.employee_id', 'emp.id')
//       .select(
//         'lb.id',
//         'lb.employee_id',
//         'emp.first_name',
//         'emp.last_name',
//         'emp.department_id',
//         'lb.company_id',
//         'lb.leave_type_id',
//         'lb.opening_balance',
//         'lb.availed',
//         'lb.available',
//         'lb.year',
//         'lt.name as leave_type_name'
//       )
//       .where('lb.company_id', company_id)
//       .andWhere('lb.year', year);

//     // 🔥 ROLE BASED FILTERING

//     // Admin / HR → All employees (no filter)
//     if (role === 'admin' || role === 'hr') {
//       // nothing to add
//     }

//     // Manager → Same department employees
//     else if (role === 'manager') {
//       if (!department_id) {
//         return res
//           .status(400)
//           .json({ message: 'Manager department not set' });
//       }

//       query.andWhere('emp.department_id', department_id);
//     }

//     // Employee → Self only
//     else {
//       query.andWhere('lb.employee_id', id);
//     }

//     const rows = await query;

//     const result = {
//       company_id,
//       year,
//       balances: rows.map(r => ({
//         employee_id: r.employee_id,
//         employee_name: `${r.first_name || ''} ${r.last_name || ''}`.trim(),
//         department_id: r.department_id,
//         leave_type_id: r.leave_type_id,
//         leave_type_name: r.leave_type_name,
//         opening_balance: r.opening_balance,
//         availed: r.availed,
//         available: r.available
//       }))
//     };

//     res.json({
//       success: true,
//       data: result
//     });

//   } catch (error) {
//     console.error('Get leave balances error:', error);
//     res.status(500).json({ message: 'Server error' });
//   }
// };

const getLeaveBalance = async (req, res) => {
  try {
    const { company_id } = req.user;
    const leaveCycle = await getLeaveCycleForDate(knex, company_id, new Date());
    const year = leaveCycle.year;

    await reconcileMissingLeaveBalances({ companyId: company_id, year, cycle: leaveCycle });

    let query = knex("leave_balances as lb")
      .join("leave_types as lt", "lb.leave_type_id", "lt.id")
      .join("employees as emp", "lb.employee_id", "emp.id")
      .select(
        "lb.id",
        "lb.employee_id",
        "emp.first_name",
        "emp.last_name",
        "emp.department_id",
        "emp.gender",
        "lb.company_id",
        "lb.leave_type_id",
        "lb.opening_balance",
        "lb.availed",
        "lb.available",
        "lb.year",
        "lt.name as leave_type_name",
        "lt.is_paid as leave_type_is_paid",
        "lt.annual_limit as leave_type_annual_limit",
        "lt.status as leave_type_status",
      )
      .where("lb.company_id", company_id)
      .andWhere("lb.year", year);

    // ===============================
    // ROLE BASED ACCESS
    // ===============================

    if (
      !hasAnyRole(req.user, [
        "admin",
        "hr",
        "manager",
        "finance",
        "ceo",
        "superadmin",
      ])
    ) {
      const employee = await resolveEmployeeProfile(req, company_id);
      query.andWhere("lb.employee_id", employee?.id || 0);
    }

    const rows = (await query).filter((row) =>
      isLeaveTypeEligibleForEmployee(row, row),
    );

    const result = {
      company_id,
      year,
      leave_cycle: {
        start: leaveCycle.start,
        end: leaveCycle.end,
      },
      balances: rows.map((r) => ({
        employee_id: r.employee_id,
        employee_name: `${r.first_name || ""} ${r.last_name || ""}`.trim(),
        department_id: r.department_id,
        leave_type_id: r.leave_type_id,
        leave_type_name: r.leave_type_name,
        opening_balance: r.opening_balance,
        availed: r.availed,
        available: r.available,
      })),
    };

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("Get leave balances error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

const calculateLeaveForConfirmedEmployee = async (employeeId, companyId) => {
  try {
    const result = await assignLeaveBalancesForEmployee(employeeId, companyId);
    if (!result.success) {
      return { success: false, message: result.reason };
    }
    return {
      success: true,
      message:
        result.inserted > 0
          ? "Leave calculated successfully for confirmed employee"
          : "No new leave balances created",
      inserted: result.inserted,
    };
  } catch (error) {
    console.error("Error calculating leave for confirmed employee:", error);
    return { success: false, message: "Server error" };
  }
};

// const getRelevantUsers = async (req, res) => {
//   try {
//     const userId = req.user.id;
//     const userRole = req.user.role; // employee role (HR, Manager, Sales, etc.)

//     // Fetch current employee
//     const employee = await knex('employees').where({ id: userId }).first();
//     if (!employee) return res.status(404).json({ message: 'Employee not found' });

//     let result;

//     if (userRole === 'employee') {
//       // 1️⃣ Employee: Get department head + all HR
//       const departmentHead = await knex('departments')
//         .where({ id: employee.department_id })
//         .select('head')
//         .first();

//       const hrUsers = await knex('employees')
//         .whereRaw("TRIM(LOWER(role)) = ?", ['hr'])
//         .select(
//           'id',
//           knex.raw("CONCAT(first_name, ' ', last_name) AS name"),
//           'department_id',
//           'role'
//         );

//       result = {
//         manager: departmentHead ? { name: departmentHead.head } : null,
//         hr: hrUsers
//       };

//     } else if (['admin', 'manager', 'hr'].includes(userRole.toLowerCase())) {
//       // 2️⃣ Admin/Manager/HR: Get all Admin + HR
//       const adminUsers = await knex('employees')
//         .whereRaw("TRIM(LOWER(role)) = ?", ['admin'])
//         .select(
//           'id',
//           knex.raw("CONCAT(first_name, ' ', last_name) AS name"),
//           'department_id',
//           'role'
//         );

//       const hrUsers = await knex('employees')
//         .whereRaw("TRIM(LOWER(role)) = ?", ['hr'])
//         .select(
//           'id',
//           knex.raw("CONCAT(first_name, ' ', last_name) AS name"),
//           'department_id',
//           'role'
//         );

//       result = { admin: adminUsers, hr: hrUsers };

//     } else {
//       return res.status(403).json({ message: 'Access denied' });
//     }

//     res.json(result);

//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ message: 'Server error' });
//   }
// };

const getRelevantUsers = async (req, res) => {
  try {
    const workflowRole = resolveWorkflowRole(req.user);
    const companyId = req.user.company_id;

    if (!companyId) {
      return res
        .status(400)
        .json({ message: "You are not assigned to any company" });
    }

    const userSelectColumns = [
      "id",
      knex.raw("CONCAT(first_name, ' ', last_name) AS name"),
      "department_id",
      "role",
    ];

    const getUsersByRole = async (roleName) => {
      const employeeUsers = await knex("employees")
        .whereRaw("TRIM(LOWER(role)) = ?", [roleName])
        .andWhere({ company_id: companyId })
        .select(...userSelectColumns);

      const appUsers = await knex("users")
        .whereRaw("TRIM(LOWER(role)) = ?", [roleName])
        .andWhere({ company_id: companyId })
        .select(
          knex.raw("CONCAT('user:', id) AS id"),
          "name",
          knex.raw("NULL AS department_id"),
          "role",
          "email",
        );

      return [...employeeUsers, ...appUsers];
    };

    let result;

    // Use one role workflow only. The old duplicate block below first built an
    // HR list for admins and then overwrote it with a CEO list, causing the UI
    // to report a false "role mapping mismatch" warning.
    if (workflowRole === "employee") {
      const employee = await resolveEmployeeProfile(req, companyId);

      if (!employee)
        return res.status(404).json({ message: "Employee not found" });

      const hasDepartmentHeadId = await knex.schema.hasColumn(
        "departments",
        "head_id",
      );
      const hasDepartmentHeadName = await knex.schema.hasColumn(
        "departments",
        "head_name",
      );
      const departmentHeadColumns = [];
      if (hasDepartmentHeadId) departmentHeadColumns.push("head_id");
      if (hasDepartmentHeadName) departmentHeadColumns.push("head_name");

      const departmentHead =
        employee.department_id && departmentHeadColumns.length > 0
          ? await knex("departments")
              .where({ id: employee.department_id, company_id: companyId })
              .select(...departmentHeadColumns)
              .first()
          : null;

      const [adminUsers, ceoUsers] = await Promise.all([
        getUsersByRole("admin"),
        getUsersByRole("ceo"),
      ]);

      let manager = null;
      if (departmentHead?.head_id) {
        const headEmployee = await knex("employees")
          .where({ id: departmentHead.head_id, company_id: companyId })
          .select(...userSelectColumns)
          .first();
        if (headEmployee) {
          manager = headEmployee;
        }
      }
      if (!manager && departmentHead?.head_name) {
        manager = { name: departmentHead.head_name };
      }

      result = {
        manager,
        admin: adminUsers,
        ceo: ceoUsers,
      };
    } else if (["manager", "hr", "admin", "ceo"].includes(workflowRole)) {
      const ceoUsers = await getUsersByRole("ceo");
      result = { ceo: ceoUsers };
    }

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

module.exports = {
  applyLeave,
  getLeaveApplications,
  updateLeaveStatus,
  getLeaveTypes,
  getLeaveBalance,
  initializeLeaveBalance,
  calculateLeaveForConfirmedEmployee,
  getRelevantUsers,
  assignLeaveBalancesForEmployee,
  backfillLeaveBalancesForLeaveType,
  reconcileMissingLeaveBalances,
};
