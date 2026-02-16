// src/controllers/leavePermissionController.js
const knex = require('../db/db');
const upload = require('../middleware/leaveAttachmentUpload');
const { sendLeavePermissionNotification } = require('../utils/sendLeavePermissionStatusNotification');
const { sendLeavePermissionStatusNotification } = require('../utils/sendLeavePermissionStatusNotification');
const { generateAutoNumber } = require('../utils/generateAutoNumber');

// Apply Leave Permission (company scoped)
const applyLeavePermission = async (req, res) => {
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
    const userRole = req.user.role;

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
          'designation_id'
        )
        .first();

      if (!employee) {
        if (req.file) fs.unlinkSync(req.file.path);
        return res.status(404).json({ message: 'Employee not found or access denied' });
      }

      const employeeName = `${employee.first_name} ${employee.last_name || ''}`.trim();

      const { permission_date, permission_time_from, permission_time_to, reason } = req.body;

      if (!permission_date || !permission_time_from || !permission_time_to || !reason) {
        if (req.file) fs.unlinkSync(req.file.path);
        return res.status(400).json({ message: 'All fields required' });
      }

      // ===============================
      // FILE ATTACHMENT
      // ===============================
      let attachmentPath = null;
      if (req.file) {
        attachmentPath = `/uploads/leave-permission-attachments/${req.file.filename}`;
      }

      // ===============================
      // CREATE LEAVE PERMISSION APPLICATION
      // ===============================
      // Generate permission ID (PRM001 format)
      const lastPermission = await knex('leave_permissions')
        .where({ company_id: companyId })
        .orderBy('id', 'desc')
        .first();

      let nextNumber = 1;
      if (lastPermission && lastPermission.permission_id) {
        const match = lastPermission.permission_id.match(/PRM(\d+)/);
        if (match) {
          nextNumber = parseInt(match[1]) + 1;
        }
      }

      const permission_id = `PRM${nextNumber.toString().padStart(3, '0')}`;

      const [newId] = await knex('leave_permissions').insert({
        company_id: companyId,
        permission_id,
        employee_id: employeeId,
        employee_name: employeeName,
        permission_date,
        permission_time_from,
        permission_time_to,
        reason,
        attachment_path: attachmentPath,
        status: 'pending'
      });

      const newPermission = await knex('leave_permissions')
        .where({ id: newId })
        .first();

      // ===============================
      // 📧 EMAIL NOTIFICATION LOGIC
      // ===============================
      const toEmails = [];

      console.log('================ LEAVE PERMISSION EMAIL DEBUG ================');
      console.log('Applicant ID:', employee.id);
      console.log('Applicant Role (token):', userRole);
      console.log('Applicant Department:', employee.department_id);
      console.log('Applicant Designation:', employee.designation_id);

      // Get Manager Designation
      const managerDesignation = await knex('designations')
        .whereRaw('LOWER(name) = ?', ['manager'])
        .andWhere({ company_id: companyId })
        .first();

      // Get HR Department
      const hrDepartment = await knex('departments')
        .whereRaw('LOWER(name) = ?', ['hr'])
        .andWhere({ company_id: companyId })
        .first();

      console.log('Manager Designation:', managerDesignation);
      console.log('HR Department:', hrDepartment);

      // ===============================
      // 1️⃣ EMPLOYEE → ASSIGNED REPORTING MANAGER + SAME DEPT MANAGER + ALL HR
      // ===============================
      if (userRole === 'employee') {
        // First, get the assigned reporting manager from employee record
        if (employee.reporting_manager_id) {
          const assignedManager = await knex('employees')
            .where({
              company_id: companyId,
              id: employee.reporting_manager_id,
              status: 'Active'
            })
            .select('id', 'first_name', 'last_name', 'email')
            .first();

          console.log('Employee → Assigned Reporting Manager Found:', assignedManager);

          if (assignedManager?.email) {
            toEmails.push(assignedManager.email);
          }
        }

        // Also get same department manager (if different from assigned)
        if (managerDesignation && employee.department_id) {
          const deptManager = await knex('employees')
            .where({
              company_id: companyId,
              department_id: employee.department_id,
              designation_id: managerDesignation.id,
              status: 'Active'
            })
            .whereNot('id', employee.reporting_manager_id || 0) // Exclude if same as assigned
            .select('id', 'first_name', 'last_name', 'email')
            .first();

          console.log('Employee → Dept Manager Found:', deptManager);

          if (deptManager?.email && !toEmails.includes(deptManager.email)) {
            toEmails.push(deptManager.email);
          }
        }

        // Also get ALL HR users
        const hrUsers = await knex('employees')
          .where({
            company_id: companyId,
            role: 'hr',
            status: 'Active'
          })
          .select('id', 'first_name', 'last_name', 'email');

        console.log('Employee → HR Users Found:', hrUsers);

        hrUsers.forEach(hr => {
          if (hr?.email && !toEmails.includes(hr.email)) {
            toEmails.push(hr.email);
          }
        });
      }

      // ===============================
      // 2️⃣ MANAGER → ALL HR
      // ===============================
      else if (userRole === 'manager') {
        // Get ALL HR users
        const hrUsers = await knex('employees')
          .where({
            company_id: companyId,
            role: 'hr',
            status: 'Active'
          })
          .select('id', 'first_name', 'last_name', 'email');

        console.log('Manager → HR Users Found:', hrUsers);

        hrUsers.forEach(hr => {
          if (hr?.email) {
            toEmails.push(hr.email);
          }
        });
      }

      // ===============================
      // 3️⃣ HR → ADMIN
      // ===============================
      else if (userRole === 'hr') {
        const adminUser = await knex('employees')
          .where({
            company_id: companyId,
            role: 'admin',
            status: 'Active'
          })
          .select('id', 'first_name', 'last_name', 'email')
          .first();

        console.log('HR → Admin Found:', adminUser);

        if (adminUser?.email) {
          toEmails.push(adminUser.email);
        }
      }

      // ===============================
      // 4️⃣ ADMIN → ALL HR
      // ===============================
      else if (userRole === 'admin') {
        // Get ALL HR users
        const hrUsers = await knex('employees')
          .where({
            company_id: companyId,
            role: 'hr',
            status: 'Active'
          })
          .select('id', 'first_name', 'last_name', 'email');

        console.log('Admin → HR Users Found:', hrUsers);

        hrUsers.forEach(hr => {
          if (hr?.email) {
            toEmails.push(hr.email);
          }
        });
      }

      // ===============================
      // FALLBACK
      // ===============================
      if (toEmails.length === 0) {
        const fallback = process.env.DEFAULT_HR_EMAIL || 'hr@company.com';
        console.log('⚠️ Using FALLBACK EMAIL:', fallback);
        toEmails.push(fallback);
      }

      console.log('📧 FINAL Leave Permission notification recipients:', toEmails);
      console.log('📊 Recipient Count:', toEmails.length);
      console.log('👥 Recipients:', toEmails.join(', '));
      console.log('=========================================================');

      // ===============================
      // SEND EMAIL
      // ===============================
      if (toEmails.length > 0) {
        await sendLeavePermissionNotification(
          toEmails,
          newPermission,
          {
            employee_name: employeeName,
            employee_email: employee.email
          }
        );
        console.log('✅ Email notification sent successfully to all recipients');
      } else {
        console.warn('⚠️ No valid email recipients found - notification not sent');
      }

      // ===============================
      // RESPONSE
      // ===============================
      res.status(201).json({
        success: true,
        message: 'Leave permission request submitted successfully!',
        permission: {
          ...newPermission,
          attachment_url: attachmentPath
            ? `${process.env.BASE_URL}${attachmentPath}`
            : null
        }
      });

    } catch (error) {
      if (req.file) fs.unlinkSync(req.file.path);
      console.error('Apply leave permission error:', error);
      res.status(500).json({ message: 'Server error' });
    }
  });
};

// Get Leave Permission Applications (role-based)
const getLeavePermissionApplications = async (req, res) => {
  const companyId = req.user.company_id;
  if (!companyId) {
    return res.status(400).json({ message: 'You are not assigned to any company' });
  }

  try {
    let query = knex('leave_permissions')
      .leftJoin(
        'employees as approver',
        'leave_permissions.approved_by',
        'approver.id'
      )
      .where('leave_permissions.company_id', companyId)
      .select(
        'leave_permissions.*',
        'approver.first_name as approved_by_first_name',
        'approver.last_name as approved_by_last_name'
      )
      .orderBy('leave_permissions.created_at', 'desc');

    if (req.user.role === 'employee') {
      query = query.where(
        'leave_permissions.employee_id',
        req.user.id
      );
    } 
    else if (req.user.role === 'manager') {
      query = query.where(builder => {
        builder
          .where('leave_permissions.employee_id', req.user.id)
          .orWhereExists(function () {
            this.select(1)
              .from('employees as team')
              .where('team.company_id', companyId)
              .whereRaw(
                'manager_name = CONCAT(?, " ", COALESCE(?, ""))',
                [req.user.first_name || '', req.user.last_name || '']
              )
              .whereRaw(
                'team.id = leave_permissions.employee_id'
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
    console.error('Get leave permission applications error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Approve/Reject Leave Permission (HR/Admin only - company scoped)
const updateLeavePermissionStatus = async (req, res) => {
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
    // GET LEAVE PERMISSION APPLICATION
    // ===============================
    const permission = await knex('leave_permissions')
      .where({ id, company_id: companyId })
      .first();

    if (!permission) return res.status(404).json({ message: 'Permission request not found' });
    if (permission.status !== 'pending') return res.status(400).json({ message: 'Request already processed' });

    // ===============================
    // GET APPLICANT EMPLOYEE
    // ===============================
    const applicant = await knex('employees')
      .where({ id: permission.employee_id, company_id: companyId })
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
    // UPDATE LEAVE PERMISSION APPLICATION
    // ===============================
    await knex('leave_permissions')
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
    await sendLeavePermissionStatusNotification(permission, { employee_name: employeeFullName, employee_email: applicant.email }, status);

    res.json({ success: true, message: `Leave permission ${status} successfully!` });

  } catch (error) {
    console.error('Update leave permission status error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Get relevant users for leave permission notifications
const getLeavePermissionRelevantUsers = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const companyId = req.user.company_id;

    // Fetch current employee
    const employee = await knex('employees')
      .where({ id: userId, company_id: companyId })
      .first();
    
    if (!employee) return res.status(404).json({ message: 'Employee not found' });

    let result = [];

    // ===============================
    // 1️⃣ EMPLOYEE → SAME DEPT MANAGER + ALL HR
    // ===============================
    if (userRole === 'employee') {
      // Get same department managers
      if (employee.department_id) {
        const deptManagers = await knex('employees')
          .where({
            company_id: companyId,
            department_id: employee.department_id,
            role: 'manager',
            status: 'Active'
          })
          .select(
            'id',
            'first_name',
            'last_name',
            'email',
            'role',
            'department_id'
          );

        result.push(...deptManagers.map(mgr => ({
          ...mgr,
          fullName: `${mgr.first_name} ${mgr.last_name || ''}`.trim(),
          isManager: true,
          isHR: false,
          isSameDepartment: true
        })));
      }

      // Get all HR users
      const hrUsers = await knex('employees')
        .where({
          company_id: companyId,
          role: 'hr',
          status: 'Active'
        })
        .select(
          'id',
          'first_name',
          'last_name',
          'email',
          'role',
          'department_id'
        );

      result.push(...hrUsers.map(hr => ({
        ...hr,
        fullName: `${hr.first_name} ${hr.last_name || ''}`.trim(),
        isManager: false,
        isHR: true,
        isSameDepartment: false
      })));
    }

    // ===============================
    // 2️⃣ MANAGER → ALL HR
    // ===============================
    else if (userRole === 'manager') {
      const hrUsers = await knex('employees')
        .where({
          company_id: companyId,
          role: 'hr',
          status: 'Active'
        })
        .select(
          'id',
          'first_name',
          'last_name',
          'email',
          'role',
          'department_id'
        );

      result.push(...hrUsers.map(hr => ({
        ...hr,
        fullName: `${hr.first_name} ${hr.last_name || ''}`.trim(),
        isManager: false,
        isHR: true,
        isSameDepartment: false
      })));
    }

    // ===============================
    // 3️⃣ HR → ALL ADMIN
    // ===============================
    else if (userRole === 'hr') {
      const adminUsers = await knex('employees')
        .where({
          company_id: companyId,
          role: 'admin',
          status: 'Active'
        })
        .select(
          'id',
          'first_name',
          'last_name',
          'email',
          'role',
          'department_id'
        );

      result.push(...adminUsers.map(admin => ({
        ...admin,
        fullName: `${admin.first_name} ${admin.last_name || ''}`.trim(),
        isManager: false,
        isHR: false,
        isAdmin: true,
        isSameDepartment: false
      })));
    }

    // ===============================
    // 4️⃣ ADMIN → ALL HR
    // ===============================
    else if (userRole === 'admin') {
      const hrUsers = await knex('employees')
        .where({
          company_id: companyId,
          role: 'hr',
          status: 'Active'
        })
        .select(
          'id',
          'first_name',
          'last_name',
          'email',
          'role',
          'department_id'
        );

      result.push(...hrUsers.map(hr => ({
        ...hr,
        fullName: `${hr.first_name} ${hr.last_name || ''}`.trim(),
        isManager: false,
        isHR: true,
        isSameDepartment: false
      })));
    }

    // Sort: same-dept managers first, then HR, then others
    result.sort((a, b) => {
      if (a.isManager && a.isSameDepartment && !(b.isManager && b.isSameDepartment)) return -1;
      if (!(a.isManager && a.isSameDepartment) && b.isManager && b.isSameDepartment) return 1;
      if (a.isHR && !b.isHR) return -1;
      if (!a.isHR && b.isHR) return 1;
      if (a.isAdmin && !b.isAdmin) return -1;
      if (!a.isAdmin && b.isAdmin) return 1;
      return 0;
    });

    res.json({
      success: true,
      data: result
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = {
  applyLeavePermission,
  getLeavePermissionApplications,
  updateLeavePermissionStatus,
  getLeavePermissionRelevantUsers
};
