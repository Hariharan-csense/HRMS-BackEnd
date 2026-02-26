const knex = require('../db/db');
const fs = require('fs');
const path = require('path');

/**
 * GET Logged-in Employee Profile (with Department & Designation Names)
 */
// const getMyProfile = async (req, res) => {
//   try {
//     const employeeId = req.user.id;

//     const employee = await knex('employees')
//       .leftJoin('departments', 'employees.department_id', 'departments.id')
//       .leftJoin('designations', 'employees.designation_id', 'designations.id')
//       .where('employees.id', employeeId)
//       .select(
//         'employees.id',
//         'employees.employee_id',
//         'employees.first_name',
//         'employees.last_name',
//         'employees.email',
//         'employees.mobile',
//         'employees.department_id',
//         'departments.name as department_name',      // ✅
//         'employees.designation_id',
//         'designations.name as designation_name',    // ✅
//         'employees.status',
//         'employees.location_office',
//         'employees.created_at'
//       )
//       .first();

//     if (!employee) {
//       return res.status(404).json({
//         success: false,
//         message: 'Employee profile not found'
//       });
//     }

//     res.json({
//       success: true,
//       data: employee
//     });

//   } catch (error) {
//     console.error('Error fetching profile:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to fetch profile'
//     });
//   }
// };


/**
 * GET Logged-in Employee Profile
 */
const getMyProfile = async (req, res) => {
  try {
    const employeeId = req.user.id;
    const companyId = req.user.company_id;

    console.log('PROFILE DEBUG - User Info:', {
      employeeId,
      companyId,
      userType: req.user.type,
      email: req.user.email
    });

    const employee = await knex('employees')
      .leftJoin('departments', 'employees.department_id', 'departments.id')
      .leftJoin('designations', 'employees.designation_id', 'designations.id')
      .where('employees.id', employeeId)
      .andWhere('employees.company_id', companyId) // ✅ CRITICAL: Filter by company_id
      .select(
        'employees.id',
        'employees.employee_id',
        'employees.first_name',
        'employees.last_name',
        'employees.email',
        'employees.mobile',
        'employees.profile_photo',          // ✅ ADD THIS
        'employees.department_id',
        'departments.name as department_name',
        'employees.designation_id',
        'designations.name as designation_name',
        'employees.status',
        'employees.location_office',
        'employees.doj',
        'employees.created_at'
      )
      .first();

    if (!employee) {
      console.log('PROFILE DEBUG - Employee not found for company:', companyId);
      return res.status(404).json({
        success: false,
        message: 'Employee not found'
      });
    }

    console.log('PROFILE DEBUG - Profile loaded successfully:', {
      employeeId: employee.id,
      name: employee.first_name,
      company_id: companyId
    });

    res.json({
      success: true,
      data: employee
    });

  } catch (error) {
    console.error('Error fetching profile:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch profile'
    });
  }
};



/**
 * UPDATE Logged-in Employee Profile
 */
/**
 * UPDATE Logged-in Employee Profile (WITH Profile Photo)
 */
const updateMyProfile = async (req, res) => {
  try {
    const employeeId = req.user.id;
    const companyId = req.user.company_id;

    console.log('PROFILE UPDATE DEBUG - User Info:', {
      employeeId,
      companyId,
      userType: req.user.type,
      email: req.user.email
    });

    const {
      first_name,
      last_name,
      mobile,
      department_id,
      designation_id
    } = req.body;

    const updateData = {
      first_name,
      last_name,
      mobile,
      department_id,
      designation_id,
      updated_at: knex.fn.now()
    };

    // ✅ If profile photo uploaded, save FULL PATH
    if (req.file && req.uploadedProfilePath) {
      updateData.profile_photo = req.uploadedProfilePath;
    }

    // Update with company_id filter to prevent cross-company data modification
    const updateResult = await knex('employees')
      .where('id', employeeId)
      .andWhere('company_id', companyId) // ✅ CRITICAL: Filter by company_id
      .update(updateData);

    if (updateResult === 0) {
      console.log('PROFILE UPDATE DEBUG - No employee found to update for company:', companyId);
      return res.status(404).json({
        success: false,
        message: 'Employee not found or unauthorized'
      });
    }

    const updatedEmployee = await knex('employees')
      .leftJoin('departments', 'employees.department_id', 'departments.id')
      .leftJoin('designations', 'employees.designation_id', 'designations.id')
      .where('employees.id', employeeId)
      .andWhere('employees.company_id', companyId) // ✅ CRITICAL: Filter by company_id
      .select(
        'employees.id',
        'employees.employee_id',
        'employees.first_name',
        'employees.last_name',
        'employees.email',
        'employees.mobile',
        'employees.profile_photo',   // ✅ FULL PATH
        'employees.department_id',
        'departments.name as department_name',
        'employees.designation_id',
        'designations.name as designation_name',
        'employees.status'
      )
      .first();

    console.log('PROFILE UPDATE DEBUG - Profile updated successfully:', {
      employeeId: updatedEmployee.id,
      name: updatedEmployee.first_name,
      company_id: companyId
    });

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: updatedEmployee
    });

  } catch (error) {
    console.error('Error updating profile:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update profile'
    });
  }
};

/**
 * DELETE Admin Account + Organization Data
 * Warning: destructive operation. Requires confirmation text "DELETE".
 */
const deleteMyAccountAndOrganization = async (req, res) => {
  try {
    const userId = Number(req.user?.id);
    const companyId = Number(req.user?.company_id);
    const userType = String(req.user?.type || '').toLowerCase();
    const userRole = String(req.user?.role || '').toLowerCase();
    const confirmation = String(req.body?.confirmation || '').trim().toUpperCase();

    if (userType !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Only admin users can delete organization account.'
      });
    }

    if (userRole === 'superadmin') {
      return res.status(403).json({
        success: false,
        message: 'Superadmin account cannot be deleted from profile.'
      });
    }

    if (!companyId) {
      return res.status(400).json({
        success: false,
        message: 'No organization is linked to this admin account.'
      });
    }

    if (confirmation !== 'DELETE') {
      return res.status(400).json({
        success: false,
        message: 'Please type DELETE to confirm account deletion.'
      });
    }

    const company = await knex('companies').where({ id: companyId }).first();
    if (!company) {
      return res.status(404).json({
        success: false,
        message: 'Organization not found.'
      });
    }

    const companyCode = company.company_id ? String(company.company_id) : null;

    await knex.transaction(async (trx) => {
      const employeeRows = await trx('employees').where({ company_id: companyId }).select('id');
      const userRows = await trx('users').where({ company_id: companyId }).select('id');
      const employeeIds = employeeRows.map((r) => r.id);
      const userIds = userRows.map((r) => r.id);

      const companyColumnTablesRaw = await trx.raw(`
        SELECT DISTINCT TABLE_NAME
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND COLUMN_NAME = 'company_id'
      `);
      const companyColumnTables = (companyColumnTablesRaw[0] || []).map((r) => r.TABLE_NAME);

      const doNotDeleteByCompany = new Set(['companies', 'knex_migrations', 'knex_migrations_lock']);
      const deleteCompanyLast = new Set(['users', 'employees']);

      for (const tableName of companyColumnTables) {
        if (doNotDeleteByCompany.has(tableName) || deleteCompanyLast.has(tableName)) continue;
        const query = trx(tableName).where('company_id', companyId);
        if (companyCode) query.orWhere('company_id', companyCode);
        await query.del();
      }

      if (employeeIds.length > 0) {
        const employeeColumnTablesRaw = await trx.raw(`
          SELECT DISTINCT c.TABLE_NAME
          FROM INFORMATION_SCHEMA.COLUMNS c
          LEFT JOIN INFORMATION_SCHEMA.COLUMNS c2
            ON c.TABLE_SCHEMA = c2.TABLE_SCHEMA
           AND c.TABLE_NAME = c2.TABLE_NAME
           AND c2.COLUMN_NAME = 'company_id'
          WHERE c.TABLE_SCHEMA = DATABASE()
            AND c.COLUMN_NAME = 'employee_id'
            AND c2.COLUMN_NAME IS NULL
        `);
        const employeeColumnTables = (employeeColumnTablesRaw[0] || []).map((r) => r.TABLE_NAME);

        for (const tableName of employeeColumnTables) {
          if (['employees', 'knex_migrations', 'knex_migrations_lock'].includes(tableName)) continue;
          await trx(tableName).whereIn('employee_id', employeeIds).del();
        }
      }

      if (userIds.length > 0) {
        const userColumnTablesRaw = await trx.raw(`
          SELECT DISTINCT c.TABLE_NAME
          FROM INFORMATION_SCHEMA.COLUMNS c
          LEFT JOIN INFORMATION_SCHEMA.COLUMNS c2
            ON c.TABLE_SCHEMA = c2.TABLE_SCHEMA
           AND c.TABLE_NAME = c2.TABLE_NAME
           AND c2.COLUMN_NAME = 'company_id'
          WHERE c.TABLE_SCHEMA = DATABASE()
            AND c.COLUMN_NAME = 'user_id'
            AND c2.COLUMN_NAME IS NULL
        `);
        const userColumnTables = (userColumnTablesRaw[0] || []).map((r) => r.TABLE_NAME);

        for (const tableName of userColumnTables) {
          if (['users', 'knex_migrations', 'knex_migrations_lock'].includes(tableName)) continue;
          await trx(tableName).whereIn('user_id', userIds).del();
        }
      }

      const deleteEmployeesQuery = trx('employees').where('company_id', companyId);
      if (companyCode) deleteEmployeesQuery.orWhere('company_id', companyCode);
      await deleteEmployeesQuery.del();

      const deleteUsersQuery = trx('users').where('company_id', companyId);
      if (companyCode) deleteUsersQuery.orWhere('company_id', companyCode);
      await deleteUsersQuery.del();
      await trx('companies').where({ id: companyId }).del();
    });

    if (company.logo) {
      const logoPath = path.join(__dirname, '..', company.logo.replace(/^\/+/, ''));
      if (fs.existsSync(logoPath)) {
        fs.unlinkSync(logoPath);
      }
    }

    const uploadRoot = path.join(__dirname, '..', 'uploads');
    const companyFolderName = `company_${companyId}`;
    const companyUploadDirs = [
      path.join(uploadRoot, 'attendance', companyFolderName),
      path.join(uploadRoot, 'employees', companyFolderName),
      path.join(uploadRoot, 'leave-attachments', companyFolderName),
      path.join(uploadRoot, 'expense-receipts', companyFolderName),
    ];

    for (const dir of companyUploadDirs) {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }

    return res.json({
      success: true,
      message: 'Account and organization data deleted permanently.'
    });
  } catch (error) {
    console.error('Error deleting account and organization:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete account and organization data.'
    });
  }
};


module.exports = {
  getMyProfile,
  updateMyProfile,
  deleteMyAccountAndOrganization
};
