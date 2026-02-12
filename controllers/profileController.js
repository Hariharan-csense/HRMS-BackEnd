const knex = require('../db/db');

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

    const employee = await knex('employees')
      .leftJoin('departments', 'employees.department_id', 'departments.id')
      .leftJoin('designations', 'employees.designation_id', 'designations.id')
      .where('employees.id', employeeId)
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
      return res.status(404).json({
        success: false,
        message: 'Employee not found'
      });
    }

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

    await knex('employees')
      .where('id', employeeId)
      .update(updateData);

    const updatedEmployee = await knex('employees')
      .leftJoin('departments', 'employees.department_id', 'departments.id')
      .leftJoin('designations', 'employees.designation_id', 'designations.id')
      .where('employees.id', employeeId)
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


module.exports = {
  getMyProfile,
  updateMyProfile
};
