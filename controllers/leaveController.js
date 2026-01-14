// src/controllers/leaveController.js
const knex = require('../db/db');
const upload = require('../middleware/leaveAttachmentUpload');
const { sendLeaveNotification } = require('../utils/sendLeaveNotification');
const { sendLeaveStatusNotification } = require('../utils/sendLeaveStatusNotification');

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
    // 1️⃣ Get active leave types for company
    const leaveTypes = await knex('leave_types')
      .where({
        status: 'active',
        company_id: companyId
      })
      .select('id', 'name', 'annual_limit');

    if (!leaveTypes.length) {
      console.warn('No active leave types found');
      return;
    }

    for (const lt of leaveTypes) {
      const existing = await knex('leave_balances')
        .where({
          employee_id: employeeId,
          company_id: companyId,
          leave_type_id: lt.id,
          year
        })
        .first();

      if (!existing) {
        await knex('leave_balances').insert({
          company_id: companyId,          // ✅ REQUIRED
          employee_id: employeeId,
          leave_type_id: lt.id,
          opening_balance: lt.annual_limit,
          availed: 0,
          available: lt.annual_limit,
          year
        });

        console.log(
          `Initialized ${lt.name} balance for employee ${employeeId}: ${lt.annual_limit} days`
        );
      }
    }
  } catch (error) {
    console.error('Error initializing leave balance:', error);
  }
};


// Apply Leave (company scoped)
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

    try {
      // ===============================
      // GET EMPLOYEE DETAILS
      // ===============================
      const employee = await knex('employees')
        .where({ id: employeeId, company_id: companyId })
        .select('id', 'first_name', 'last_name', 'email', 'department_id')
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
      // CHECK LEAVE BALANCE
      // ===============================
      const currentYear = new Date().getFullYear();

      const balance = await knex('leave_balances')
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
      const application_id = await generateId('leave_applications', 'LA', companyId);
      const leaveType = await knex('leave_types')
        .where({ id: leave_type_id })
        .first();

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
      // 📧 EMAIL NOTIFICATION LOGIC
      // ===============================
      const toEmails = [];

      // 1️⃣ SAME DEPARTMENT MANAGER
      if (employee.department_id) {
        const departmentManager = await knex('employees')
          .where({
            company_id: companyId,
            department_id: employee.department_id,
            role: 'manager',
            status: 'Active'
          })
          .select('email')
          .first();

        if (departmentManager?.email) {
          toEmails.push(departmentManager.email);
        }
      }

      // 2️⃣ COMPANY HR (ONLY ONE)
      if (toEmails.length === 0) {
        const companyHR = await knex('employees')
          .where({
            company_id: companyId,
            role: 'hr',
            status: 'Active'
          })
          .select('email')
          .first();

        if (companyHR?.email) {
          toEmails.push(companyHR.email);
        }
      }

      // 3️⃣ DEFAULT HR
      if (toEmails.length === 0) {
        toEmails.push(process.env.DEFAULT_HR_EMAIL || 'hr@company.com');
      }

      // ===============================
      // SEND EMAIL
      // ===============================
      if (toEmails.length > 0) {
        await sendLeaveNotification(
          toEmails,
          newApplication,
          {
            employee_name: employeeName,
            employee_email: employee.email
          },
          leaveType
        );
      }

      // ===============================
      // RESPONSE
      // ===============================
      res.status(201).json({
        success: true,
        message: 'Leave application submitted successfully!',
        application: {
          ...newApplication,
          attachment_url: attachmentPath
            ? `${process.env.BASE_URL || 'http://localhost:5000'}${attachmentPath}`
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

// Get Leave Applications (company scoped + role-based)
// const getLeaveApplications = async (req, res) => {
//   const companyId = req.user.company_id;
//   if (!companyId) {
//     return res.status(400).json({ message: 'You are not assigned to any company' });
//   }

//   try {
//     let query = knex('leave_applications')
//       .leftJoin('employees as approver', 'leave_applications.approved_by', 'approver.id')
//       .where('leave_applications.company_id', companyId)
//       .select(
//         'leave_applications.*',
//         'approver.first_name as approved_by_first_name',
//         'approver.last_name as approved_by_last_name'
//       )
//       .orderBy('created_at', 'desc');

//     if (req.user.role === 'employee') {
//       query = query.where('employee_id', req.user.id);
//     } else if (req.user.role === 'manager') {
//       query = query.where(builder => {
//         builder.where('employee_id', req.user.id)
//           .orWhereExists(function() {
//             this.select(1)
//               .from('employees as team')
//               .where('team.company_id', companyId)
//               .whereRaw('team.manager_name = CONCAT(?, " ", COALESCE(?, ""))', 
//                 [req.user.first_name || '', req.user.last_name || ''])
//               .whereRaw('team.id = leave_applications.employee_id');
//           });
//       });
//     }
//     // Admin/HR sees all in company

//     const applications = await query;

//     const enriched = applications.map(app => ({
//       ...app,
//       approved_by_name: app.approved_by_first_name 
//         ? `${app.approved_by_first_name} ${app.approved_by_last_name || ''}`.trim()
//         : null,
//       attachment_url: app.attachment_path 
//         ? `${app.attachment_path}` 
//         : null
//     }));

//     res.json({
//       success: true,
//       count: enriched.length,
//       applications: enriched
//     });

//   } catch (error) {
//     console.error('Get leave applications error:', error);
//     res.status(500).json({ message: 'Server error' });
//   }
// };


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
                'team.manager_name = CONCAT(?, " ", COALESCE(?, ""))',
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
    // UPDATE LEAVE BALANCE (IF APPROVED)
    // ===============================
    if (status === 'approved') {
      const currentYear = new Date().getFullYear();

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

// Get Leave Balance for Employee (company scoped)
const getLeaveBalance = async (req, res) => {
  const companyId = req.user.company_id;
  if (!companyId) {
    return res.status(400).json({ message: 'You are not assigned to any company' });
  }

  const employeeId = req.user.id;
  const currentYear = new Date().getFullYear();

  try {
    const balances = await knex('leave_balances')
      .leftJoin('leave_types', 'leave_balances.leave_type_id', 'leave_types.id')
      .where({ 
        'leave_balances.employee_id': employeeId, 
        'leave_balances.year': currentYear 
      })
      .select(
        'leave_balances.*',
        'leave_types.name as leave_type_name'
      );

    res.json({
      success: true,
      balances
    });
  } catch (error) {
    console.error('Get leave balance error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};


module.exports = {
  applyLeave,
  getLeaveApplications,
  updateLeaveStatus,
  getLeaveTypes,
  getLeaveBalance,
  initializeLeaveBalance
};