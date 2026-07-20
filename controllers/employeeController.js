// src/controllers/employeeController.js
const knex = require("../db/db");
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");
const { sendEmployeeWelcomeMail } = require("../utils/sendEmployeeWelcomeMail");
const {
  initializeLeaveBalance,
  calculateLeaveForConfirmedEmployee,
} = require("../controllers/leaveController");
const { isEmployeeFullTime } = require("../services/leaveBalanceService");

const EMPLOYEE_DUPLICATE_FIELD_CONFIG = [
  {
    key: "employee_id",
    label: "Employee ID",
    normalize: (value) => String(value).trim().toUpperCase(),
  },
  {
    key: "email",
    label: "Email",
    normalize: (value) => String(value).trim().toLowerCase(),
  },
  {
    key: "mobile",
    label: "Phone number",
    normalize: (value) => String(value).trim(),
  },
  {
    key: "office_phone",
    label: "Office phone number",
    normalize: (value) => String(value).trim(),
  },
  {
    key: "office_email",
    label: "Office email",
    normalize: (value) => String(value).trim().toLowerCase(),
  },
  {
    key: "emergency_contact_phone",
    label: "Emergency contact number",
    normalize: (value) => String(value).trim(),
  },
  {
    key: "aadhaar",
    label: "Aadhaar number",
    normalize: (value) => String(value).trim().toUpperCase(),
  },
  {
    key: "pan",
    label: "PAN number",
    normalize: (value) => String(value).trim().toUpperCase(),
  },
];

let employeeColumnsCache = null;

const buildDuplicateMessage = (label) => `${label} already exists`;

const getEmployeeColumns = async () => {
  if (!employeeColumnsCache) {
    employeeColumnsCache = await knex("employees").columnInfo();
  }

  return employeeColumnsCache;
};

const normalizeValueForComparison = (config, value) => {
  if (value === undefined || value === null) return null;
  const normalized = config.normalize(value);
  return normalized ? normalized : null;
};

const normalizeModuleKey = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const textIncludesLiveTracking = (value) => {
  const text = String(value || "").toLowerCase();
  return (
    (text.includes("live") && text.includes("tracking")) ||
    text.includes("tracking_management") ||
    text.includes("tracking management")
  );
};

const getLiveTrackingSeatLimit = async (companyId) => {
  const subscription = await knex("company_subscriptions")
    .leftJoin(
      "subscription_plans",
      "company_subscriptions.plan_id",
      "subscription_plans.id",
    )
    .where("company_subscriptions.company_id", companyId)
    .whereIn("company_subscriptions.status", ["trial", "active"])
    .orderBy("company_subscriptions.created_at", "desc")
    .select(
      "company_subscriptions.id",
      "company_subscriptions.status",
      "company_subscriptions.trial_end_date",
      "subscription_plans.name as plan_name",
      "subscription_plans.description as plan_description",
    )
    .first();

  if (!subscription) return 0;

  const basePlanText = `${subscription.plan_name || ""} ${subscription.plan_description || ""}`;
  const basePlanHasLiveTracking =
    textIncludesLiveTracking(basePlanText) ||
    /standard|professional|pro|advanced|advance|enterprise|premium/i.test(
      String(subscription.plan_name || ""),
    );

  if (basePlanHasLiveTracking) return null;

  const hasCompanyAddons = await knex.schema.hasTable(
    "company_subscription_addons",
  );
  const hasAddons = await knex.schema.hasTable("subscription_addons");
  if (!hasCompanyAddons || !hasAddons) return 0;

  const addonColumns = await knex("subscription_addons").columnInfo();
  const moduleKeySelect = addonColumns.module_key
    ? "subscription_addons.module_key"
    : knex.raw("NULL as module_key");

  const addonRows = await knex("company_subscription_addons")
    .join(
      "subscription_addons",
      "company_subscription_addons.addon_id",
      "subscription_addons.id",
    )
    .where("company_subscription_addons.subscription_id", subscription.id)
    .where("subscription_addons.is_active", true)
    .select(
      "company_subscription_addons.users_count",
      "subscription_addons.name",
      "subscription_addons.description",
      moduleKeySelect,
    );

  return addonRows.reduce((total, addon) => {
    const moduleKey = normalizeModuleKey(addon.module_key);
    const addonText = `${addon.name || ""} ${addon.description || ""}`;
    if (
      moduleKey === "live_tracking" ||
      moduleKey === "tracking_management" ||
      textIncludesLiveTracking(addonText)
    ) {
      return total + Number(addon.users_count || 0);
    }
    return total;
  }, 0);
};

const assertLiveTrackingSeatLimit = async ({
  companyId,
  targetEmployeeId = null,
  wantsTracking,
}) => {
  if (!wantsTracking) return null;

  const seatLimit = await getLiveTrackingSeatLimit(companyId);
  if (seatLimit === null) return null;

  if (seatLimit <= 0) {
    return "Live tracking is not available in this subscription. Please buy a live tracking add-on or upgrade the plan.";
  }

  const enabledQuery = knex("employees").where({
    company_id: companyId,
    location_tracking_enabled: 1,
  });

  if (targetEmployeeId) {
    enabledQuery.whereNot({ id: targetEmployeeId });
  }

  const enabledCountRow = await enabledQuery.count("* as count").first();
  const enabledCount = parseInt(enabledCountRow.count, 10) || 0;

  if (enabledCount >= seatLimit) {
    return `Live tracking seat limit reached. This subscription allows ${seatLimit} tracking users.`;
  }

  return null;
};

const findEmployeeDuplicateMessage = async ({
  companyId,
  excludeEmployeeId = null,
  values,
}) => {
  const employeeColumns = await getEmployeeColumns();

  for (const config of EMPLOYEE_DUPLICATE_FIELD_CONFIG) {
    if (!Object.prototype.hasOwnProperty.call(employeeColumns, config.key)) {
      continue;
    }

    const normalizedValue = normalizeValueForComparison(
      config,
      values[config.key],
    );
    if (!normalizedValue) continue;

    const existingEmployee = await knex("employees")
      .where("company_id", companyId)
      .modify((queryBuilder) => {
        if (excludeEmployeeId) {
          queryBuilder.whereNot("id", excludeEmployeeId);
        }
      })
      .whereRaw(`LOWER(TRIM(COALESCE(${config.key}, ''))) = ?`, [
        normalizedValue.toLowerCase(),
      ])
      .first();

    if (existingEmployee) {
      return buildDuplicateMessage(config.label);
    }
  }

  return null;
};

const findBankDuplicateMessage = async ({
  companyId,
  excludeEmployeeId = null,
  accountNumber,
}) => {
  const normalizedAccountNumber = accountNumber
    ? String(accountNumber).trim()
    : null;

  if (!normalizedAccountNumber) return null;

  const existingBank = await knex("employee_bank_details as ebd")
    .innerJoin("employees as e", "ebd.employee_id", "e.id")
    .where("e.company_id", companyId)
    .modify((queryBuilder) => {
      if (excludeEmployeeId) {
        queryBuilder.whereNot("ebd.employee_id", excludeEmployeeId);
      }
    })
    .whereRaw("LOWER(TRIM(COALESCE(ebd.account_number, ''))) = ?", [
      normalizedAccountNumber.toLowerCase(),
    ])
    .first();

  if (existingBank) {
    return buildDuplicateMessage("Bank account number");
  }

  return null;
};

const checkEmployeeDuplicate = async (req, res) => {
  const companyId = req.user.company_id;

  if (!companyId) {
    return res.status(400).json({
      message: "You are not assigned to any company",
    });
  }

  const { field, value, excludeEmployeeId } = req.query;
  const normalizedField = String(field || "").trim();
  const config = EMPLOYEE_DUPLICATE_FIELD_CONFIG.find(
    (item) => item.key === normalizedField,
  );

  if (!config) {
    return res.status(400).json({ message: "Invalid duplicate check field" });
  }

  const normalizedValue = normalizeValueForComparison(config, value);

  if (!normalizedValue) {
    return res.json({ success: true, exists: false, message: null });
  }

  try {
    const message = await findEmployeeDuplicateMessage({
      companyId,
      excludeEmployeeId: excludeEmployeeId || null,
      values: {
        [normalizedField]: normalizedValue,
      },
    });

    return res.json({
      success: true,
      exists: Boolean(message),
      message,
    });
  } catch (error) {
    console.error("Employee duplicate check error:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

const getEmployeeDuplicateErrorMessage = (error) => {
  const rawMessage = String(
    error?.sqlMessage || error?.message || "",
  ).toLowerCase();

  if (
    error?.code !== "ER_DUP_ENTRY" &&
    !rawMessage.includes("duplicate entry") &&
    !rawMessage.includes("duplicate")
  ) {
    return null;
  }

  if (rawMessage.includes("employee_id")) {
    return buildDuplicateMessage("Employee ID");
  }
  if (rawMessage.includes("office_email")) {
    return buildDuplicateMessage("Office email");
  }
  if (rawMessage.includes("email")) {
    return buildDuplicateMessage("Email");
  }
  if (rawMessage.includes("office_phone")) {
    return buildDuplicateMessage("Office phone number");
  }
  if (rawMessage.includes("mobile")) {
    return buildDuplicateMessage("Phone number");
  }
  if (rawMessage.includes("emergency_contact_phone")) {
    return buildDuplicateMessage("Emergency contact number");
  }
  if (rawMessage.includes("aadhaar")) {
    return buildDuplicateMessage("Aadhaar number");
  }
  if (rawMessage.includes("pan")) {
    return buildDuplicateMessage("PAN number");
  }
  if (rawMessage.includes("account_number")) {
    return buildDuplicateMessage("Bank account number");
  }

  return "Duplicate entry already exists";
};

const cleanupFiles = (files) => {
  if (files) {
    Object.values(files)
      .flat()
      .forEach((file) => {
        const filePath = file.path;
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      });
  }
};

const buildEmployeeDocumentRows = async (files, employeeId, companyId) => {
  if (!files || files.length === 0) return [];

  const columns = await knex("employee_documents").columnInfo();
  const hasColumn = (name) =>
    Object.prototype.hasOwnProperty.call(columns, name);

  return files.map((file) => {
    const row = {};

    if (hasColumn("company_id")) row.company_id = companyId;
    row.employee_id = employeeId;

    // Support both old schema (`type`, `original_name`) and new schema
    if (hasColumn("type")) row.type = file.fieldname;
    if (hasColumn("fieldname")) row.fieldname = file.fieldname;
    if (hasColumn("filename")) row.filename = file.originalname;
    if (hasColumn("original_name")) row.original_name = file.originalname;

    // Store a public URL path instead of absolute disk path
    const publicPath = `/uploads/employees/company_${companyId}/${file.filename}`;
    row.file_path = publicPath;

    if (hasColumn("mimetype")) row.mimetype = file.mimetype;
    if (hasColumn("size")) row.size = file.size;

    return row;
  });
};

const addEmployee = async (req, res) => {
  const companyId = req.user.company_id;

  if (!companyId) {
    cleanupFiles(req.files);
    return res
      .status(400)
      .json({ message: "You are not assigned to any company" });
  }

  const {
    id,
    employee_id,
    first_name,
    last_name,
    gender,
    dob,
    blood_group,
    marital_status,
    email,
    mobile,
    office_phone,
    office_email,
    emergency_contact_name,
    emergency_contact_phone,
    doj,
    employment_type,
    shift_id = null,
    department_id,
    designation_id,
    branch_id,
    location_office,
    status = "Active",
    salary = 0,
    aadhaar,
    pan,
    uan,
    esic,
    account_holder_name,
    bank_name,
    account_number,
    ifsc_code,
    role = "employee",
    location_tracking_enabled = 0,
  } = req.body;

  try {
    const depId = department_id ? parseInt(department_id) : null;
    const desigId = designation_id ? parseInt(designation_id) : null;
    const requestedRole = String(role || "employee").trim();
    const normalizedRole = requestedRole.toLowerCase();
    const matchingRole = await knex("roles")
      .where({ company_id: companyId })
      .whereRaw("LOWER(name) = ?", [normalizedRole])
      .first("name");
    const finalRoleName = matchingRole?.name || requestedRole;

    // ✅ Only one HR per company
    if (normalizedRole === "hr") {
      const existingHR = await knex("employees")
        .where({ company_id: companyId, role: "hr" })
        .whereNot(id ? { id } : {})
        .first();

      if (existingHR) {
        cleanupFiles(req.files);
        return res.status(400).json({
          message: `This company already has an HR: ${existingHR.first_name} ${existingHR.last_name || ""}. Only one HR is allowed per company.`,
        });
      }
    }

    // --------------------
    // VALIDATE SHIFT
    // --------------------
    let finalShiftId = null;

    if (shift_id) {
      try {
        const shift = await knex("shifts")
          .where({
            id: shift_id,
            company_id: companyId,
          })
          .first();

        if (!shift) {
          cleanupFiles(req.files);
          return res.status(400).json({
            message: "Invalid shift selected",
          });
        }

        finalShiftId = shift.id;
      } catch (error) {
        console.error("Error validating shift:", error);
        cleanupFiles(req.files);
        return res.status(500).json({
          message: "Error validating shift. Please try again.",
        });
      }
    } else {
      // Shift is optional - set to null if not provided
      finalShiftId = null;
    }

    let finalBranchId = null;
    if (branch_id) {
      const branch = await knex("branches")
        .where({ id: branch_id, company_id: companyId })
        .first();

      if (!branch) {
        cleanupFiles(req.files);
        return res.status(400).json({
          message: "Invalid branch selected",
        });
      }

      finalBranchId = branch.id;
    } else {
      finalBranchId = null;
    }

    const normalizedLocationTrackingEnabled =
      location_tracking_enabled === 1 ||
      location_tracking_enabled === "1" ||
      location_tracking_enabled === true ||
      location_tracking_enabled === "true"
        ? 1
        : 0;

    let employeeId;
    let message;
    // ======================
    // UPDATE EMPLOYEE
    // ======================
    if (id) {
      const existing = await knex("employees")
        .where({ id, company_id: companyId })
        .first();

      if (!existing) {
        cleanupFiles(req.files);
        return res
          .status(404)
          .json({ message: "Employee not found or access denied" });
      }

      const trackingSeatError = await assertLiveTrackingSeatLimit({
        companyId,
        targetEmployeeId: id,
        wantsTracking: normalizedLocationTrackingEnabled === 1,
      });
      if (trackingSeatError) {
        cleanupFiles(req.files);
        return res.status(403).json({ message: trackingSeatError });
      }

      await knex("employees")
        .where({ id, company_id: companyId })
        .update({
          employee_id: employee_id.trim().toUpperCase(),
          first_name: first_name.trim(),
          last_name: last_name.trim(),
          gender: gender || null,
          dob: dob || null,
          blood_group: blood_group || null,
          marital_status: marital_status || null,
          email: email.trim().toLowerCase(),
          mobile: mobile || null,
          office_phone: office_phone || null,
          office_email: office_email || null,
          emergency_contact_name: emergency_contact_name || null,
          emergency_contact_phone: emergency_contact_phone || null,
          doj: doj || null,
          employment_type: employment_type || "Full-Time",
          shift_id: finalShiftId, // ✅ SAFE
          department_id: depId,
          designation_id: desigId,
          branch_id: finalBranchId,
          location_office: location_office || null,
          status,
          salary: Number(salary) || 0,
          aadhaar: aadhaar || null,
          pan: pan || null,
          uan: uan || null,
          esic: esic || null,
          role: finalRoleName,
          location_tracking_enabled: normalizedLocationTrackingEnabled,
        });

      employeeId = id;
      message = "Employee updated successfully!";
    }

    // ======================
    // CREATE EMPLOYEE
    // ======================
    else {
      const trackingSeatError = await assertLiveTrackingSeatLimit({
        companyId,
        wantsTracking: normalizedLocationTrackingEnabled === 1,
      });
      if (trackingSeatError) {
        cleanupFiles(req.files);
        return res.status(403).json({ message: trackingSeatError });
      }

      const employeeDuplicateMessage = await findEmployeeDuplicateMessage({
        companyId,
        values: {
          employee_id,
          email,
          mobile,
          office_phone,
          office_email,
          emergency_contact_phone,
          aadhaar,
          pan,
        },
      });

      if (employeeDuplicateMessage) {
        cleanupFiles(req.files);
        return res.status(400).json({ message: employeeDuplicateMessage });
      }

      const bankDuplicateMessage = await findBankDuplicateMessage({
        companyId,
        accountNumber: account_number,
      });

      if (bankDuplicateMessage) {
        cleanupFiles(req.files);
        return res.status(400).json({ message: bankDuplicateMessage });
      }

      // Generate temporary password
      const tempPassword =
        Math.random().toString(36).slice(2, 10).toUpperCase() +
        Math.random().toString(36).slice(2, 4).toUpperCase() +
        "!";
      const hashedPassword = await bcrypt.hash(tempPassword, 10);

      const [newId] = await knex("employees").insert({
        company_id: companyId,
        employee_id: employee_id.trim().toUpperCase(),
        first_name: first_name.trim(),
        last_name: last_name.trim(),
        gender: gender || null,
        dob: dob || null,
        blood_group: blood_group || null,
        marital_status: marital_status || null,
        email: email.trim().toLowerCase(),
        mobile: mobile || null,
        office_phone: office_phone || null,
        office_email: office_email || null,
        emergency_contact_name: emergency_contact_name || null,
        emergency_contact_phone: emergency_contact_phone || null,
        doj: doj || null,
        employment_type: employment_type || "Full-Time",
        shift_id: finalShiftId, // ✅ SAFE
        department_id: depId,
        designation_id: desigId,
        location_office: location_office || null,
        status,
        salary: Number(salary) || 0,
        aadhaar: aadhaar || null,
        pan: pan || null,
        uan: uan || null,
        esic: esic || null,
        branch_id: finalBranchId,
        password: hashedPassword,
        role: finalRoleName,
        location_tracking_enabled: normalizedLocationTrackingEnabled,
      });

      console.log(
        `[EMPLOYEE CREATION DEBUG] New Employee ID: ${newId}, Email: ${email.trim().toLowerCase()}, Temp Password: ${tempPassword}`,
      );

      employeeId = newId;

      // Send welcome email with temporary password
      try {
        await sendEmployeeWelcomeMail({
          name: `${first_name.trim()} ${last_name.trim()}`,
          email: email.trim().toLowerCase(),
          password: tempPassword,
        });
        message =
          "Employee added successfully! Welcome email sent with temporary password.";
      } catch (emailError) {
        console.error("Error sending welcome email:", emailError);
        message =
          "Employee added successfully! Warning: Failed to send welcome email.";
      }

      // Initialize leave balance
      await initializeLeaveBalance(employeeId, companyId);
    }

    // ======================
    // HANDLE BANK DETAILS
    // ======================
    // ======================
    // HANDLE BANK DETAILS
    // ======================
    if (account_number && ifsc_code) {
      const bankData = {
        company_id: companyId,
        employee_id: employeeId,
        account_holder_name: account_holder_name || null,
        bank_name: bank_name || null,
        account_number,
        ifsc_code,
      };

      const existingBank = await knex("employee_bank_details")
        .where({
          employee_id: employeeId,
          company_id: companyId,
        })
        .first();

      if (existingBank) {
        await knex("employee_bank_details")
          .where({
            employee_id: employeeId,
            company_id: companyId,
          })
          .update(bankData);
      } else {
        await knex("employee_bank_details").insert(bankData);
      }
    }

    // ======================
    // HANDLE EMPLOYEE DOCUMENTS (multiple fields)
    // ======================
    // ======================
    // HANDLE EMPLOYEE DOCUMENTS (multiple fields)
    // ======================
    // ======================
    // HANDLE EMPLOYEE DOCUMENTS - FINAL WORKING VERSION
    // ======================
    let allFiles = [];

    if (req.files) {
      console.log("req.files received:", req.files); // ← DEBUG: இதை போடு

      // Multer fields() returns object with fieldname as key
      Object.keys(req.files).forEach((fieldname) => {
        const files = req.files[fieldname];
        if (Array.isArray(files)) {
          allFiles = allFiles.concat(files);
        } else if (files) {
          allFiles.push(files);
        }
      });
    }

    console.log(`Total files to save: ${allFiles.length}`); // ← DEBUG

    if (allFiles.length > 0) {
      const documents = await buildEmployeeDocumentRows(
        allFiles,
        employeeId,
        companyId,
      );

      await knex("employee_documents").insert(documents);
      console.log(
        `Successfully inserted ${allFiles.length} documents for employee ${employeeId}`,
      );
    } else {
      console.log("No files uploaded for this employee");
    }

    // ======================
    // ASSIGN DEPARTMENT HEAD
    // ======================
    if ((normalizedRole === "manager" || normalizedRole === "hr") && depId) {
      await knex("departments")
        .where({ id: depId, company_id: companyId })
        .update({
          head_id: employeeId,
          head_name: `${first_name.trim()} ${last_name.trim()}`,
        });
    }

    const finalEmployee = await knex("employees")
      .where({ id: employeeId })
      .first();

    res.status(id ? 200 : 201).json({
      success: true,
      message,
      employee: finalEmployee,
    });
  } catch (error) {
    cleanupFiles(req.files);
    console.error("Employee operation error:", error);
    const duplicateMessage = getEmployeeDuplicateErrorMessage(error);
    if (duplicateMessage) {
      return res.status(400).json({ message: duplicateMessage });
    }
    res.status(500).json({ message: "Server error" });
  }
};

const getEmployees = async (req, res) => {
  const companyId = req.user.company_id;

  if (!companyId) {
    return res.status(400).json({
      message: "You are not assigned to any company",
    });
  }

  try {
    const roleSet = new Set(
      [req.user.role, ...(Array.isArray(req.user.roles) ? req.user.roles : [])]
        .map((role) =>
          String(role || "")
            .toLowerCase()
            .trim(),
        )
        .filter(Boolean),
    );
    const isManager = roleSet.has("manager");
    const canViewAllCompanyEmployees =
      roleSet.has("admin") || roleSet.has("ceo") || roleSet.has("hr");

    let managerDepartmentId = null;

    // 🔐 If MANAGER → Get department_id from employees table
    if (isManager) {
      const manager = await knex("employees")
        .select("department_id")
        .where("id", req.user.id) // employees.id
        .first();

      if (!manager || !manager.department_id) {
        return res.status(400).json({
          message: "Manager department not assigned. Contact admin.",
        });
      }

      managerDepartmentId = manager.department_id;
    }

    let baseQuery = knex("employees as e")
      .leftJoin("departments as d", "e.department_id", "d.id")
      .leftJoin("designations as des", "e.designation_id", "des.id")
      .leftJoin("branches as b", "e.branch_id", "b.id")
      .leftJoin("shifts as sh", "e.shift_id", "sh.id")
      .select(
        "e.*",
        "d.name as department_name",
        "des.name as designation_name",
        "b.name as branch_name",
        "sh.name as shift_name",
      )
      .where("e.company_id", companyId);

    // 🔐 ROLE BASED ACCESS

    // MANAGER → Same department employees
    if (isManager) {
      baseQuery.where("e.department_id", managerDepartmentId);
    }

    // NON-ADMIN & NON-MANAGER → Only self
    if (!canViewAllCompanyEmployees && !isManager) {
      baseQuery.where("e.id", req.user.id);
    }

    // ADMIN → No filter (all employees)

    const employees = await baseQuery;

    // 2️⃣ Attach bank details & documents
    const employeeIds = employees.map((e) => e.id).filter(Boolean);

    const [bankRows, documentRows] = await Promise.all([
      employeeIds.length
        ? knex("employee_bank_details").whereIn("employee_id", employeeIds)
        : Promise.resolve([]),
      employeeIds.length
        ? knex("employee_documents").whereIn("employee_id", employeeIds)
        : Promise.resolve([]),
    ]);

    const bankByEmployeeId = new Map();
    for (const row of bankRows) {
      bankByEmployeeId.set(row.employee_id, row);
    }

    const documentsByEmployeeId = new Map();
    for (const row of documentRows) {
      const list = documentsByEmployeeId.get(row.employee_id) || [];
      list.push(row);
      documentsByEmployeeId.set(row.employee_id, list);
    }

    const result = employees.map((emp) => ({
      ...emp,
      department: emp.department_name,
      designation: emp.designation_name,
      status: emp.status,
      bankDetails: bankByEmployeeId.get(emp.id) || null,
      documents: documentsByEmployeeId.get(emp.id) || [],
    }));

    return res.status(200).json({
      success: true,
      count: result.length,
      employees: result,
    });
  } catch (err) {
    console.error("Get employees error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

const getEmployeeById = async (req, res) => {
  const companyId = req.user.company_id;
  if (!companyId) {
    return res
      .status(400)
      .json({ message: "You are not assigned to any company" });
  }

  const { id } = req.params;

  try {
    const employee = await knex("employees")
      .leftJoin("departments", "employees.department_id", "departments.id")
      .leftJoin("designations", "employees.designation_id", "designations.id")
      .leftJoin("branches", "employees.branch_id", "branches.id")
      .leftJoin(
        "employee_bank_details",
        "employees.id",
        "employee_bank_details.employee_id",
      )
      .where("employees.id", id)
      .where("employees.company_id", companyId)
      .select(
        "employees.*",
        "departments.name as department_name",
        "designations.name as designation_name",
        "branches.name as branch_name",
        "employee_bank_details.account_holder_name",
        "employee_bank_details.bank_name",
        "employee_bank_details.account_number",
        "employee_bank_details.ifsc_code",
      )
      .first();

    if (!employee) {
      return res
        .status(404)
        .json({ message: "Employee not found or access denied" });
    }

    // Get documents
    const docs = await knex("employee_documents").where({
      employee_id: employee.id,
    });
    const documents = docs.map((doc) => ({
      type: doc.type,
      file_url: `${doc.file_path}`,
      original_name: doc.original_name,
    }));

    const photo = documents.find((d) => d.type === "photo");

    res.json({
      success: true,
      employee: {
        ...employee,
        branch: employee.branch_name || null,
        photo_url: photo ? photo.file_url : null,
        documents,
      },
    });
  } catch (error) {
    console.error("Get employee by ID error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// Update Employee (Admin only - company scoped)

// const updateEmployee = async (req, res) => {
//   const companyId = req.user.company_id;

//   if (!companyId) {
//     cleanupFiles(req.files);
//     return res.status(400).json({ message: 'You are not assigned to any company' });
//   }

//   const { id } = req.params;
//   const {
//     employee_id,
//     first_name,
//     last_name,
//     gender,
//     dob,
//     blood_group,
//     marital_status,
//     email,
//     mobile,
//     emergency_contact_name,
//     emergency_contact_phone,
//     doj,
//     employment_type,
//     department_id,
//     designation_id,
//     location_office,
//     status,
//     salary,
//     aadhaar,
//     pan,
//     uan,
//     esic,
//     account_holder_name,
//     bank_name,
//     account_number,
//     ifsc_code,
//     role
//   } = req.body;

//   if (!employee_id || !first_name || !last_name || !email || !doj) {
//     cleanupFiles(req.files);
//     return res.status(400).json({ message: 'Employee ID, First Name, Last Name, Email and Date of Joining are required' });
//   }

//   try {
//     const employee = await knex('employees')
//       .where({ id, company_id: companyId })
//       .first();

//     if (!employee) {
//       cleanupFiles(req.files);
//       return res.status(404).json({ message: 'Employee not found or access denied' });
//     }

//     const normalizedRole = role ? role.toLowerCase() : employee.role;
//     const depId = department_id ? parseInt(department_id) : employee.department_id;
//     const desigId = designation_id ? parseInt(designation_id) : employee.designation_id;

//     // ✅ Only one HR per company
//     if (normalizedRole === 'hr') {
//       const existingHR = await knex('employees')
//         .where({ company_id: companyId, role: 'hr' })
//         .whereNot({ id })
//         .first();

//       if (existingHR) {
//         cleanupFiles(req.files);
//         return res.status(400).json({
//           message: `This company already has an HR: ${existingHR.first_name} ${existingHR.last_name || ''}. Only one HR is allowed per company.`
//         });
//       }
//     }

//     // Duplicate email check
//     const emailExists = await knex('employees')
//       .whereRaw('LOWER(email) = ? AND company_id = ?', [email.toLowerCase(), companyId])
//       .whereNot({ id })
//       .first();

//     if (emailExists) {
//       cleanupFiles(req.files);
//       return res.status(400).json({ message: 'Email already exists in your company' });
//     }

//     // Update employee
//     await knex('employees')
//       .where({ id })
//       .update({
//         employee_id: employee_id.trim().toUpperCase(),
//         first_name: first_name.trim(),
//         last_name: last_name.trim(),
//         gender: gender || null,
//         dob: dob || null,
//         blood_group: blood_group || null,
//         marital_status: marital_status || null,
//         email: email.trim().toLowerCase(),
//         mobile: mobile || null,
//         emergency_contact_name: emergency_contact_name || null,
//         emergency_contact_phone: emergency_contact_phone || null,
//         doj,
//         employment_type: employment_type || employee.employment_type,
//         department_id: depId,
//         designation_id: desigId,
//         location_office: location_office || null,
//         status: status || employee.status,
//         salary: parseFloat(salary) || employee.salary,
//         aadhaar: aadhaar || null,
//         pan: pan || null,
//         uan: uan || null,
//         esic: esic || null,
//         role: normalizedRole
//       });

//     // Handle bank details
//     if (account_number && ifsc_code) {
//       const bankData = {
//         employee_id: id,
//         account_holder_name: account_holder_name || null,
//         bank_name: bank_name || null,
//         account_number,
//         ifsc_code
//       };

//       const existingBank = await knex('employee_bank_details').where({ employee_id: id }).first();
//       if (existingBank) {
//         await knex('employee_bank_details').where({ employee_id: id }).update(bankData);
//       } else {
//         await knex('employee_bank_details').insert(bankData);
//       }
//     }

//     // Handle documents (multiple fields)
//     let allFiles = [];
//     if (req.files) {
//       Object.values(req.files).forEach(fileArray => {
//         allFiles = allFiles.concat(fileArray);
//       });
//     }

//     if (allFiles.length > 0) {
//       const documents = allFiles.map(file => ({
//         employee_id: id,
//         filename: file.originalname,
//         fieldname: file.fieldname,
//         file_path: file.path,
//         mimetype: file.mimetype,
//         size: file.size
//       }));

//       await knex('employee_documents').insert(documents);
//     }

//     // Assign / remove department head
//     if ((normalizedRole === 'manager' || normalizedRole === 'hr') && depId) {
//       await knex('departments')
//         .where({ id: depId, company_id: companyId })
//         .update({
//           head_id: id,
//           head_name: `${first_name.trim()} ${last_name.trim()}`
//         });
//     } else {
//       await knex('departments')
//         .where({ head_id: id, company_id: companyId })
//         .update({ head_id: null, head_name: null });
//     }

//     const updatedEmployee = await knex('employees').where({ id }).first();

//     res.json({
//       success: true,
//       message: 'Employee updated successfully!',
//       employee: updatedEmployee
//     });

//   } catch (error) {
//     cleanupFiles(req.files);
//     console.error('Update employee error:', error);
//     res.status(500).json({ message: 'Server error' });
//   }
// };
const updateEmployee = async (req, res) => {
  const companyId = req.user.company_id;

  if (!companyId) {
    cleanupFiles(req.files);
    return res
      .status(400)
      .json({ message: "You are not assigned to any company" });
  }

  const { id } = req.params;
  const {
    employee_id,
    first_name,
    last_name,
    gender,
    dob,
    blood_group,
    marital_status,
    email,
    mobile,
    office_phone,
    office_email,
    emergency_contact_name,
    emergency_contact_phone,
    doj,
    employment_type,
    department_id,
    designation_id,
    branch_id,
    location_office,
    status,
    salary,
    aadhaar,
    pan,
    uan,
    esic,
    account_holder_name,
    bank_name,
    account_number,
    ifsc_code,
    role,
    shift_id,
    location_tracking_enabled,
  } = req.body;

  try {
    const employee = await knex("employees")
      .where({ id, company_id: companyId })
      .first();

    if (!employee) {
      cleanupFiles(req.files);
      return res
        .status(404)
        .json({ message: "Employee not found or access denied" });
    }

    // Build dynamic update object - only include provided fields
    const updateData = {};

    if (employee_id !== undefined)
      updateData.employee_id = employee_id.trim().toUpperCase();
    if (first_name !== undefined) updateData.first_name = first_name.trim();
    if (last_name !== undefined) updateData.last_name = last_name.trim();
    if (gender !== undefined) updateData.gender = gender || null;
    if (dob !== undefined) updateData.dob = dob || null;
    if (blood_group !== undefined) updateData.blood_group = blood_group || null;
    if (marital_status !== undefined)
      updateData.marital_status = marital_status || null;
    if (email !== undefined) {
      updateData.email = email.trim().toLowerCase();
    }
    if (mobile !== undefined) updateData.mobile = mobile || null;
    if (office_phone !== undefined)
      updateData.office_phone = office_phone || null;
    if (office_email !== undefined) {
      updateData.office_email = office_email
        ? office_email.trim().toLowerCase()
        : null;
    }
    if (emergency_contact_name !== undefined)
      updateData.emergency_contact_name = emergency_contact_name || null;
    if (emergency_contact_phone !== undefined)
      updateData.emergency_contact_phone = emergency_contact_phone || null;
    if (doj !== undefined) updateData.doj = doj;
    if (employment_type !== undefined)
      updateData.employment_type = employment_type;
    if (department_id !== undefined)
      updateData.department_id = department_id ? parseInt(department_id) : null;
    if (designation_id !== undefined)
      updateData.designation_id = designation_id
        ? parseInt(designation_id)
        : null;
    if (branch_id !== undefined)
      updateData.branch_id = branch_id ? parseInt(branch_id) : null;
    if (location_office !== undefined)
      updateData.location_office = location_office || null;
    if (status !== undefined) updateData.status = status;
    if (salary !== undefined)
      updateData.salary = salary ? parseFloat(salary) : null;
    if (aadhaar !== undefined) updateData.aadhaar = aadhaar || null;
    if (pan !== undefined) updateData.pan = pan || null;
    if (uan !== undefined) updateData.uan = uan || null;
    if (esic !== undefined) updateData.esic = esic || null;
    if (shift_id !== undefined)
      updateData.shift_id = shift_id ? parseInt(shift_id) : null;
    if (location_tracking_enabled !== undefined) {
      updateData.location_tracking_enabled =
        location_tracking_enabled === 1 ||
        location_tracking_enabled === "1" ||
        location_tracking_enabled === true ||
        location_tracking_enabled === "true"
          ? 1
          : 0;
    }

    // Role handling with HR restriction
    if (role !== undefined) {
      const requestedRole = String(role || employee.role || "").trim();
      const normalizedRole = requestedRole.toLowerCase();

      if (normalizedRole === "hr") {
        const existingHR = await knex("employees")
          .where({ company_id: companyId })
          .whereRaw("LOWER(role) = ?", ["hr"])
          .whereNot({ id })
          .first();

        if (existingHR) {
          cleanupFiles(req.files);
          return res.status(400).json({
            message: `This company already has an HR: ${existingHR.first_name} ${existingHR.last_name || ""}. Only one HR is allowed per company.`,
          });
        }
      }

      const matchingRole = await knex("roles")
        .where({ company_id: companyId })
        .whereRaw("LOWER(name) = ?", [normalizedRole])
        .first("name");

      updateData.role = matchingRole?.name || requestedRole;
    }

    if (branch_id !== undefined) {
      if (branch_id) {
        const branch = await knex("branches")
          .where({ id: branch_id, company_id: companyId })
          .first();

        if (!branch) {
          cleanupFiles(req.files);
          return res.status(400).json({
            message: "Invalid branch selected",
          });
        }

        updateData.branch_id = branch.id;
      } else {
        updateData.branch_id = null;
      }
    }

    if (updateData.location_tracking_enabled === 1) {
      const trackingSeatError = await assertLiveTrackingSeatLimit({
        companyId,
        targetEmployeeId: id,
        wantsTracking: true,
      });
      if (trackingSeatError) {
        cleanupFiles(req.files);
        return res.status(403).json({ message: trackingSeatError });
      }
    }

    const employeeDuplicateMessage = await findEmployeeDuplicateMessage({
      companyId,
      excludeEmployeeId: id,
      values: {
        employee_id:
          updateData.employee_id !== undefined
            ? updateData.employee_id
            : employee.employee_id,
        email:
          updateData.email !== undefined ? updateData.email : employee.email,
        mobile:
          updateData.mobile !== undefined ? updateData.mobile : employee.mobile,
        office_phone:
          updateData.office_phone !== undefined
            ? updateData.office_phone
            : employee.office_phone,
        office_email:
          updateData.office_email !== undefined
            ? updateData.office_email
            : employee.office_email,
        emergency_contact_phone:
          updateData.emergency_contact_phone !== undefined
            ? updateData.emergency_contact_phone
            : employee.emergency_contact_phone,
        aadhaar:
          updateData.aadhaar !== undefined
            ? updateData.aadhaar
            : employee.aadhaar,
        pan: updateData.pan !== undefined ? updateData.pan : employee.pan,
      },
    });

    if (employeeDuplicateMessage) {
      cleanupFiles(req.files);
      return res.status(400).json({ message: employeeDuplicateMessage });
    }

    // Check if there's anything to update
    const hasEmployeeUpdates = Object.keys(updateData).length > 0;
    const hasBankUpdates =
      account_number || account_holder_name || bank_name || ifsc_code;
    const hasFiles = req.files && Object.keys(req.files).length > 0;

    if (!hasEmployeeUpdates && !hasBankUpdates && !hasFiles) {
      return res.status(400).json({ message: "No data provided to update" });
    }

    // Update employee record if there are changes
    if (hasEmployeeUpdates) {
      await knex("employees").where({ id }).update(updateData);

      // Check if employee transitioned from probation to full-time
      if (
        updateData.employment_type !== undefined &&
        isEmployeeFullTime(updateData.employment_type) &&
        !isEmployeeFullTime(employee.employment_type)
      ) {
        console.log(
          `Employee ${id} transitioned from probation to full-time - calculating leave`,
        );
        const leaveResult = await calculateLeaveForConfirmedEmployee(
          id,
          companyId,
        );
        if (leaveResult.success) {
          console.log("Leave calculated successfully for confirmed employee");
        } else {
          console.error("Failed to calculate leave:", leaveResult.message);
        }
      }
    }

    // --------------------
    // VALIDATE SHIFT
    // --------------------
    let finalShiftId = null;

    if (shift_id) {
      const shift = await knex("shifts")
        .where({
          id: shift_id,
          company_id: companyId,
        })
        .first();

      if (!shift) {
        cleanupFiles(req.files);
        return res.status(400).json({
          message: "Invalid shift selected",
        });
      }

      finalShiftId = shift.id;
    } else {
      cleanupFiles(req.files);
      return res.status(400).json({
        message: "Shift is required",
      });
    }

    // Handle bank details (optional update)
    if (hasBankUpdates) {
      const bankDuplicateMessage = await findBankDuplicateMessage({
        companyId,
        excludeEmployeeId: id,
        accountNumber: account_number,
      });

      if (bankDuplicateMessage) {
        cleanupFiles(req.files);
        return res.status(400).json({ message: bankDuplicateMessage });
      }

      const bankData = {
        company_id: companyId,
        employee_id: id,
        account_holder_name: account_holder_name || null,
        bank_name: bank_name || null,
        account_number: account_number || null,
        ifsc_code: ifsc_code || null,
      };

      const existingBank = await knex("employee_bank_details")
        .where({ employee_id: id })
        .first();
      if (existingBank) {
        await knex("employee_bank_details")
          .where({ employee_id: id })
          .update(bankData);
      } else if (account_number && ifsc_code) {
        await knex("employee_bank_details").insert(bankData);
      }
    }

    // Handle document uploads
    // Handle document uploads
    let allFiles = [];

    if (req.files) {
      console.log("req.files in update:", req.files);

      Object.keys(req.files).forEach((fieldname) => {
        const files = req.files[fieldname];
        if (Array.isArray(files)) {
          allFiles = allFiles.concat(files);
        } else if (files) {
          allFiles.push(files);
        }
      });
    }

    if (allFiles.length > 0) {
      const documents = await buildEmployeeDocumentRows(
        allFiles,
        id,
        companyId,
      );

      await knex("employee_documents").insert(documents);
      console.log(
        `Uploaded ${allFiles.length} new documents for employee ${id}`,
      );
    }

    // Department head assignment (only if role or department changed)
    const finalRole = updateData.role || employee.role;
    const finalRoleKey = String(finalRole || "").toLowerCase();
    const finalDeptId =
      updateData.department_id !== undefined
        ? updateData.department_id
        : employee.department_id;

    if ((finalRoleKey === "manager" || finalRoleKey === "hr") && finalDeptId) {
      await knex("departments")
        .where({ id: finalDeptId, company_id: companyId })
        .update({
          head_id: id,
          head_name: `${updateData.first_name || employee.first_name} ${updateData.last_name || employee.last_name}`,
        });
    } else if (updateData.role || updateData.department_id !== undefined) {
      // Remove head role if no longer manager/hr or department changed
      await knex("departments")
        .where({ head_id: id, company_id: companyId })
        .update({ head_id: null, head_name: null });
    }

    const updatedEmployee = await knex("employees").where({ id }).first();

    res.json({
      success: true,
      message: "Employee updated successfully!",
      employee: updatedEmployee,
    });
  } catch (error) {
    cleanupFiles(req.files);
    console.error("Update employee error:", error);
    const duplicateMessage = getEmployeeDuplicateErrorMessage(error);
    if (duplicateMessage) {
      return res.status(400).json({ message: duplicateMessage });
    }
    res.status(500).json({ message: "Server error" });
  }
};

// Delete Employee (company scoped)
const deleteEmployee = async (req, res) => {
  const companyId = req.user.company_id;
  if (!companyId) {
    return res
      .status(400)
      .json({ message: "You are not assigned to any company" });
  }

  const { id } = req.params;

  try {
    const employee = await knex("employees")
      .where({ id, company_id: companyId })
      .first();

    if (!employee) {
      return res
        .status(404)
        .json({ message: "Employee not found or access denied" });
    }

    // Delete document files
    const docs = await knex("employee_documents").where({ employee_id: id });
    docs.forEach((doc) => {
      const filePath = path.join(__dirname, "..", "..", doc.file_path);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    });

    // Delete related records
    await knex("employee_documents").where({ employee_id: id }).del();
    await knex("employee_bank_details").where({ employee_id: id }).del();
    await knex("employees").where({ id }).del();

    res.json({
      success: true,
      message: "Employee deleted successfully!",
    });
  } catch (error) {
    console.error("Delete employee error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

module.exports = {
  addEmployee,
  checkEmployeeDuplicate,
  getEmployees,
  getEmployeeById,
  updateEmployee,
  deleteEmployee,
};
