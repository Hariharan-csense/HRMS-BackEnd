// src/controllers/leaveController.js
const knex = require('../db/db');
const upload = require('../middleware/leaveAttachmentUpload');
const { sendLeaveNotification } = require('../utils/sendLeaveNotification');
const { sendLeaveStatusNotification } = require('../utils/sendLeaveStatusNotification');
const {generateAutoNumber} = require('../utils/generateAutoNumber');
const {
  assignLeaveBalancesForEmployee,
  backfillLeaveBalancesForLeaveType,
  reconcileMissingLeaveBalances
} = require('../services/leaveBalanceService');

// Auto generate IDs per company
const generateId = async (table, prefix, companyId) => {
  const last = await knex(table)
    .where({ company_id: companyId })
    .orderBy('id', 'desc')
    .first();

  if (!last) return `${prefix}001`;

  const columnName = table === 'leave_applications' ? 'application_id' : `${prefix.toLowerCase()}_id`;
  const num = parseInt(last[columnName].replace(prefix, '')) + 1;
  return `${prefix}${String(num).padStart(3, '0')}`;
};

// Initialize leave balance for new employee or new year
const initializeLeaveBalance = async (
  employeeId,
  companyId,
  year = new Date().getFullYear()
) => {
  try {
    const result = await assignLeaveBalancesForEmployee(employeeId, companyId, { year });
    if (!result.success) {
      console.warn(`Leave balance initialization skipped for employee ${employeeId}: ${result.reason}`);
    }
    return result;
  } catch (error) {
    console.error('Error initializing leave balance:', error);
    return { success: false, inserted: 0, reason: 'error' };
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
      return res.status(400).json({ message: 'You are not assigned to any company' });
    }

    const employeeId = req.user.id;
    const userRole = req.user.role; // 🔥 FROM TOKEN

    try {
      // ===============================
      // GET EMPLOYEE DETAILS
      // ===============================
      const employee = await knex('employees')
        .where({ id: employeeId, company_id: companyId })
        .select(
          'id',
          'first_name',
          'last_name',
          'email',
          'department_id',
          'designation_id',
          'employment_type'
        )
        .first();

      if (!employee) {
        if (req.file) fs.unlinkSync(req.file.path);
        return res.status(404).json({ message: 'Employee not found or access denied' });
      }

      const employeeName = `${employee.first_name} ${employee.last_name || ''}`.trim();

      const { leave_type_id, from_date, to_date, reason } = req.body;

      if (!leave_type_id || !from_date || !to_date || !reason) {
        if (req.file) fs.unlinkSync(req.file.path);
        return res.status(400).json({ message: 'All fields required' });
      }

      // ===============================
      // CALCULATE LEAVE DAYS
      // ===============================
      const days =
        Math.ceil((new Date(to_date) - new Date(from_date)) / (1000 * 60 * 60 * 24)) + 1;

      // ===============================
      // CHECK LEAVE BALANCE / PROBATION (LOP) HANDLING
      // ===============================
      const currentYear = new Date().getFullYear();

      // Get the requested leave type (company scoped)
      let leaveType = await knex('leave_types')
        .where({ id: leave_type_id, company_id: companyId })
        .first();

      // If employee is on probation, treat leave as unpaid (loss of pay)
      if (employee.employment_type === 'Probation') {
        // Try to find an existing unpaid leave type for the company
        let unpaid = await knex('leave_types')
          .where({ company_id: companyId, is_paid: false })
          .first();

        if (!unpaid) {
          // Create a company-scoped Unpaid Leave type if not present
          // Generate leave type ID (LVT001 format)
          const lastLeaveType = await knex('leave_types')
            .where({ company_id: companyId })
            .orderBy('id', 'desc')
            .first();

          let nextNumber = 1;
          if (lastLeaveType && lastLeaveType.leave_type_id) {
            const match = lastLeaveType.leave_type_id.match(/LVT(\d+)/);
            if (match) {
              nextNumber = parseInt(match[1]) + 1;
            }
          }

          const lt_code = `LVT${nextNumber.toString().padStart(3, '0')}`;
          await knex('leave_types').insert({
            leave_type_id: lt_code,
            name: 'Unpaid Leave',
            is_paid: false,
            annual_limit: 0,
            carry_forward: 0,
            encashable: false,
            description: 'Auto-created unpaid leave for probation employees',
            status: 'active',
            company_id: companyId
          });

          unpaid = await knex('leave_types')
            .where({ leave_type_id: lt_code, company_id: companyId })
            .first();
        }

        if (unpaid) {
          leave_type_id = unpaid.id; // override to unpaid leave
          leaveType = unpaid;
        }
      }

      // If leave type is paid, ensure balance exists and is sufficient
      let balance = null;
      if (leaveType && leaveType.is_paid) {
        balance = await knex('leave_balances')
          .where({
            employee_id: employeeId,
            leave_type_id,
            year: currentYear
          })
          .first();

        if (!balance || balance.available < days) {
          if (req.file) fs.unlinkSync(req.file.path);
          return res.status(400).json({ message: 'Insufficient leave balance' });
        }
      }

      // ===============================
      // FILE ATTACHMENT
      // ===============================
      let attachmentPath = null;
      if (req.file) {
        attachmentPath = `/uploads/leave-attachments/${req.file.filename}`;
      }

      // ===============================
      // CREATE LEAVE APPLICATION
      // ===============================
      // Generate application ID (APP001 format)
      const lastApplication = await knex('leave_applications')
        .where({ company_id: companyId })
        .orderBy('id', 'desc')
        .first();

      let nextNumber = 1;
      if (lastApplication && lastApplication.application_id) {
        const match = lastApplication.application_id.match(/APP(\d+)/);
        if (match) {
          nextNumber = parseInt(match[1]) + 1;
        }
      }

      const application_id = `APP${nextNumber.toString().padStart(3, '0')}`;

      // ensure leaveType is available for notification later
      if (!leaveType) {
        leaveType = await knex('leave_types')
          .where({ id: leave_type_id })
          .first();
      }

      const [newId] = await knex('leave_applications').insert({
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
        status: 'pending'
      });

      const newApplication = await knex('leave_applications')
        .where({ id: newId })
        .first();

      // ===============================
      // 📧 FINAL EMAIL LOGIC — collect HR and include admins when HR exists
      // Use a Set to dedupe and scope queries by company
      // ===============================
      const recipientSet = new Set();

      console.log('================ APPLY LEAVE EMAIL DEBUG ================');
      console.log('Applicant ID:', employee.id);
      console.log('Applicant Role (token):', userRole);
      console.log('Applicant Department:', employee.department_id);
      console.log('Applicant Designation:', employee.designation_id);

      // Get Manager Designation
      const managerDesignation = await knex('designations')
        .whereRaw('LOWER(name) = ?', ['manager'])
        .andWhere({ company_id: companyId })
        .first();

      // Get HR Department (if any)
      const hrDepartment = await knex('departments')
        .whereRaw('LOWER(name) = ?', ['hr'])
        .andWhere({ company_id: companyId })
        .first();

      console.log('Manager Designation:', managerDesignation);
      console.log('HR Department:', hrDepartment);

      // Helper: fetch all HR emails for company (may be multiple)
      const fetchCompanyHrEmails = async () => {
        const hrs = await knex('employees')
          .whereRaw("TRIM(LOWER(role)) = ?", ['hr'])
          .andWhere({ company_id: companyId, status: 'Active' })
          .select('email');
        return hrs.map(h => h.email).filter(Boolean);
      };

      // Helper: fetch all admin emails for company
      const fetchAdminEmails = async () => {
        const admins = await knex('employees')
          .whereRaw("TRIM(LOWER(role)) = ?", ['admin'])
          .andWhere({ company_id: companyId, status: 'Active' })
          .select('email');
        return admins.map(a => a.email).filter(Boolean);
      };

      // 1️⃣ EMPLOYEE → Dept Manager + HR (if present) + Admins (if HR present)
      if (userRole === 'employee') {
        if (managerDesignation && employee.department_id) {
          const deptManager = await knex('employees')
            .where({
              company_id: companyId,
              department_id: employee.department_id,
              designation_id: managerDesignation.id,
              status: 'Active'
            })
            .select('email')
            .first();

          if (deptManager?.email) recipientSet.add(deptManager.email);
        }

        const hrEmails = await fetchCompanyHrEmails();
        hrEmails.forEach(e => recipientSet.add(e));

        if (hrEmails.length > 0) {
          const adminEmails = await fetchAdminEmails();
          adminEmails.forEach(e => recipientSet.add(e));
        }
      }

      // 2️⃣ MANAGER → HR (+ admins if HR exists)
      else if (userRole === 'manager') {
        const hrEmails = await fetchCompanyHrEmails();
        hrEmails.forEach(e => recipientSet.add(e));

        if (hrEmails.length > 0) {
          const adminEmails = await fetchAdminEmails();
          adminEmails.forEach(e => recipientSet.add(e));
        }
      }

      // 3️⃣ HR → ADMIN (keep existing behavior but allow multiple admins)
      else if (userRole === 'hr') {
        const adminEmails = await fetchAdminEmails();
        adminEmails.forEach(e => recipientSet.add(e));
      }

      // 4️⃣ ADMIN → HR (+ include admins too so they get a copy)
      else if (userRole === 'admin') {
        const hrEmails = await fetchCompanyHrEmails();
        hrEmails.forEach(e => recipientSet.add(e));

        // include admins as well so admin group receives notification
        const adminEmails = await fetchAdminEmails();
        adminEmails.forEach(e => recipientSet.add(e));
      }

      // FALLBACK
      let toEmails = Array.from(recipientSet);
      if (toEmails.length === 0) {
        const fallback = process.env.DEFAULT_HR_EMAIL || 'hr@company.com';
        console.log('⚠️ Using FALLBACK EMAIL:', fallback);
        toEmails = [fallback];
      }

      console.log('📧 FINAL Leave notification recipients:', toEmails);
      console.log('=========================================================');

      // SEND EMAIL
      await sendLeaveNotification(
        toEmails,
        newApplication,
        {
          employee_name: employeeName,
          employee_email: employee.email
        },
        leaveType
      );

      // ===============================
      // RESPONSE
      // ===============================
      res.status(201).json({
        success: true,
        message: 'Leave application submitted successfully!',
        application: {
          ...newApplication,
          attachment_url: attachmentPath
            ? `${process.env.BASE_URL}${attachmentPath}`
            : null
        }
      });

    } catch (error) {
      if (req.file) fs.unlinkSync(req.file.path);
      console.error('Apply leave error:', error);
      res.status(500).json({ message: 'Server error' });
    }
  });
};



const getLeaveApplications = async (req, res) => {
  const companyId = req.user.company_id;
  if (!companyId) {
    return res.status(400).json({ message: 'You are not assigned to any company' });
  }

  try {
    let query = knex('leave_applications')
      .leftJoin(
        'employees as approver',
        'leave_applications.approved_by',
        'approver.id'
      )
      .where('leave_applications.company_id', companyId)
      .select(
        'leave_applications.*',
        'approver.first_name as approved_by_first_name',
        'approver.last_name as approved_by_last_name'
      )
      .orderBy('leave_applications.created_at', 'desc');

    if (req.user.role === 'employee') {
      query = query.where(
        'leave_applications.employee_id',
        req.user.id
      );
    } 
    else if (req.user.role === 'manager') {
      query = query.where(builder => {
        builder
          .where('leave_applications.employee_id', req.user.id)
          .orWhereExists(function () {
            this.select(1)
              .from('employees as team')
              .where('team.company_id', companyId)
              .whereRaw(
                'manager_name = CONCAT(?, " ", COALESCE(?, ""))',
                [req.user.first_name || '', req.user.last_name || '']
              )
              .whereRaw(
                'team.id = leave_applications.employee_id'
              );
          });
      });
    }
    // Admin / HR → all applications

    const applications = await query;

    const enriched = applications.map(app => ({
      ...app,
      approved_by_name: app.approved_by_first_name
        ? `${app.approved_by_first_name} ${app.approved_by_last_name || ''}`.trim()
        : null,
      attachment_url: app.attachment_path || null
    }));

    res.json({
      success: true,
      count: enriched.length,
      applications: enriched
    });

  } catch (error) {
    console.error('Get leave applications error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};


// Approve/Reject Leave (HR/Admin only - company scoped)
const updateLeaveStatus = async (req, res) => {
  const companyId = req.user.company_id;

  if (!companyId) {
    return res.status(400).json({ message: 'You are not assigned to any company' });
  }

  const { id } = req.params;
  const { status, remarks } = req.body;

  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ message: 'Invalid status' });
  }

  try {
    // ===============================
    // GET LEAVE APPLICATION
    // ===============================
    const application = await knex('leave_applications')
      .where({ id, company_id: companyId })
      .first();

    if (!application) return res.status(404).json({ message: 'Application not found' });
    if (application.status !== 'pending') return res.status(400).json({ message: 'Application already processed' });

    // ===============================
    // GET APPLICANT EMPLOYEE
    // ===============================
    const applicant = await knex('employees')
      .where({ id: application.employee_id, company_id: companyId })
      .select('id', 'first_name', 'last_name', 'email', 'department_id')
      .first();

    if (!applicant) return res.status(404).json({ message: 'Employee not found' });

    // ===============================
    // AUTHORIZATION CHECK
    // ===============================
    let isAuthorized = false;
    if (req.user.role === 'hr') isAuthorized = true;
    if (req.user.role === 'manager' && applicant.department_id) {
      const manager = await knex('employees')
        .where({
          id: req.user.id,
          company_id: companyId,
          department_id: applicant.department_id,
          role: 'manager'
        })
        .first();
      if (manager) isAuthorized = true;
    }
    if (!isAuthorized) return res.status(403).json({ message: 'Not authorized' });

    // ===============================
    // UPDATE LEAVE BALANCE (IF APPROVED) - skip for unpaid leave (LOP)
    // ===============================
    if (status === 'approved') {
      const currentYear = new Date().getFullYear();

      // fetch leave type to determine if it's paid
      const applicationLeaveType = await knex('leave_types')
        .where({ id: application.leave_type_id, company_id: companyId })
        .first();

      // If leave type is paid, update balances as before
      if (applicationLeaveType && applicationLeaveType.is_paid) {
        const balance = await knex('leave_balances')
          .where({
            employee_id: application.employee_id,
            leave_type_id: application.leave_type_id,
            year: currentYear
          })
          .first();

        if (!balance) return res.status(400).json({ message: 'Leave balance not found' });

        // Ensure numeric values to prevent NaN
        const total = Number(balance.total ?? balance.opening_balance) || 0;
        const availed = Number(balance.availed) || 0;

        const newAvailed = availed + application.days;
        const newAvailable = total - newAvailed;

        if (newAvailable < 0) {
          return res.status(400).json({
            message: 'Insufficient leave balance',
            leave_type_id: application.leave_type_id,
            requested_days: application.days,
            available_days: total - availed
          });
        }

        await knex('leave_balances')
          .where({ id: balance.id })
          .update({
            availed: newAvailed,
            available: newAvailable
          });
      } else {
        // unpaid leave (loss of pay) — do not touch leave balances
      }
    }

    // ===============================
    // UPDATE LEAVE APPLICATION
    // ===============================
    await knex('leave_applications')
      .where({ id })
      .update({
        status,
        approved_by: req.user.id,
        approved_at: knex.fn.now(),
        remarks: remarks || null
      });

    // ===============================
    // SEND EMAIL TO EMPLOYEE
    // ===============================
    const employeeFullName = `${applicant.first_name} ${applicant.last_name || ''}`.trim();
    await sendLeaveStatusNotification(application, { employee_name: employeeFullName, employee_email: applicant.email }, status);

    res.json({ success: true, message: `Leave ${status} successfully!` });

  } catch (error) {
    console.error('Update leave status error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};


// Get Leave Types (company scoped)
const getLeaveTypes = async (req, res) => {
  const companyId = req.user.company_id;
  if (!companyId) {
    return res.status(400).json({ message: 'You are not assigned to any company' });
  }

  try {
    const types = await knex('leave_types')
      .where({ company_id: companyId, status: 'active' })
      .orderBy('name');

    res.json({
      success: true,
      leaveTypes: types
    });
  } catch (error) {
    console.error('Get leave types error:', error);
    res.status(500).json({ message: 'Server error' });
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
    const { id, company_id, role } = req.user;
    const year = new Date().getFullYear();

    let query = knex('leave_balances as lb')
      .join('leave_types as lt', 'lb.leave_type_id', 'lt.id')
      .join('employees as emp', 'lb.employee_id', 'emp.id')
      .select(
        'lb.id',
        'lb.employee_id',
        'emp.first_name',
        'emp.last_name',
        'emp.department_id',
        'lb.company_id',
        'lb.leave_type_id',
        'lb.opening_balance',
        'lb.availed',
        'lb.available',
        'lb.year',
        'lt.name as leave_type_name'
      )
      .where('lb.company_id', company_id)
      .andWhere('lb.year', year)
      

    // ===============================
    // ROLE BASED ACCESS
    // ===============================

    if (role === 'admin') {
      // ✅ Admin → all employees (no filter)
    } else {
      // ✅ Employee (and others) → self only
      query.andWhere('lb.employee_id', id);
    }

    const rows = await query;

    const result = {
      company_id,
      year,
      balances: rows.map(r => ({
        employee_id: r.employee_id,
        employee_name: `${r.first_name || ''} ${r.last_name || ''}`.trim(),
        department_id: r.department_id,
        leave_type_id: r.leave_type_id,
        leave_type_name: r.leave_type_name,
        opening_balance: r.opening_balance,
        availed: r.availed,
        available: r.available
      }))
    };

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    console.error('Get leave balances error:', error);
    res.status(500).json({ message: 'Server error' });
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
      message: result.inserted > 0 ? 'Leave calculated successfully for confirmed employee' : 'No new leave balances created',
      inserted: result.inserted
    };
  } catch (error) {
    console.error('Error calculating leave for confirmed employee:', error);
    return { success: false, message: 'Server error' };
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
    const userId = req.user.id;
    const userRole = (req.user.role || '').toLowerCase(); // employee role (HR, Manager, Sales, etc.)
    const companyId = req.user.company_id;

    if (!companyId) {
      return res.status(400).json({ message: 'You are not assigned to any company' });
    }

    const userSelectColumns = [
      'id',
      knex.raw("CONCAT(first_name, ' ', last_name) AS name"),
      'department_id',
      'role'
    ];

    const getUsersByRole = async (roleName) => {
      return knex('employees')
        .whereRaw("TRIM(LOWER(role)) = ?", [roleName])
        .andWhere({ company_id: companyId })
        .select(...userSelectColumns);
    };

    let result;

    // Employee -> department head + all HR + all Admin
    if (userRole === 'employee') {
      const employee = await knex('employees')
        .where({ id: userId, company_id: companyId })
        .first();

      if (!employee) return res.status(404).json({ message: 'Employee not found' });

      // Get department head using current schema (head_name, head_id)
      const departmentHead = await knex('departments')
        .where({ id: employee.department_id, company_id: companyId })
        .select('head_name', 'head_id')
        .first();

      const [hrUsers, adminUsers] = await Promise.all([
        getUsersByRole('hr'),
        getUsersByRole('admin')
      ]);

      let manager = null;
      if (departmentHead?.head_id) {
        const headEmployee = await knex('employees')
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
        hr: hrUsers
      };

    // Admin/Manager -> only HR list
    } else if (['admin', 'manager'].includes(userRole)) {
      const hrUsers = await getUsersByRole('hr');
      result = { hr: hrUsers };

    // HR -> only Admin list
    } else if (userRole === 'hr') {
      const adminUsers = await getUsersByRole('admin');
      result = { admin: adminUsers };

    } else {
      return res.status(403).json({ message: 'Access denied' });
    }

    res.json(result);

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
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
  reconcileMissingLeaveBalances
};
