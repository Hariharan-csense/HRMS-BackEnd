const { requestDeletion } = require("../middleware/deletionApproval");
const knex = require("../db/db");
const fs = require("fs");
const path = require("path");
const { warmEmployeeFaceDescriptor } = require("../utils/faceRecognition");
const { uploadRoot, resolveUploadPath } = require("../utils/uploadPaths");

const resolveEmployeeIdFromAuth = async (req) => {
  const companyId = Number(req.user?.company_id);
  if (!companyId) return null;
  const userType = String(req.user?.type || "")
    .toLowerCase()
    .trim();

  if (req.user?.employee_id) {
    const direct = await knex("employees")
      .where({ id: Number(req.user.employee_id), company_id: companyId })
      .first();
    if (direct) return Number(direct.id);
  }

  if (userType === "employee") {
    const fallbackById = await knex("employees")
      .where({ id: Number(req.user?.id), company_id: companyId })
      .first();
    if (fallbackById) return Number(fallbackById.id);
  }

  if (req.user?.email) {
    const byEmail = await knex("employees")
      .where({ company_id: companyId })
      .whereRaw("LOWER(email) = ?", [
        String(req.user.email).toLowerCase().trim(),
      ])
      .first();
    if (byEmail) return Number(byEmail.id);
  }

  return null;
};

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
    const employeeId = await resolveEmployeeIdFromAuth(req);
    const companyId = req.user.company_id;

    console.log("PROFILE DEBUG - User Info:", {
      employeeId,
      companyId,
      userType: req.user.type,
      email: req.user.email,
    });

    const employee = await knex("employees")
      .leftJoin("departments", "employees.department_id", "departments.id")
      .leftJoin("designations", "employees.designation_id", "designations.id")
      .where("employees.id", employeeId)
      .andWhere("employees.company_id", companyId) // ✅ CRITICAL: Filter by company_id
      .select(
        "employees.id",
        "employees.employee_id",
        "employees.first_name",
        "employees.last_name",
        "employees.email",
        "employees.mobile",
        "employees.profile_photo", // ✅ ADD THIS
        "employees.department_id",
        "departments.name as department_name",
        "employees.designation_id",
        "designations.name as designation_name",
        "employees.status",
        "employees.location_office",
        "employees.doj",
        "employees.created_at",
      )
      .first();

    if (!employee) {
      console.log("PROFILE DEBUG - Employee not found for company:", companyId);
      return res.status(404).json({
        success: false,
        message: "Employee not found",
      });
    }

    console.log("PROFILE DEBUG - Profile loaded successfully:", {
      employeeId: employee.id,
      name: employee.first_name,
      company_id: companyId,
    });

    res.json({
      success: true,
      data: employee,
    });
  } catch (error) {
    console.error("Error fetching profile:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch profile",
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
    const employeeId = await resolveEmployeeIdFromAuth(req);
    const companyId = req.user.company_id;

    console.log("PROFILE UPDATE DEBUG - User Info:", {
      employeeId,
      companyId,
      userType: req.user.type,
      email: req.user.email,
    });

    const { first_name, last_name, mobile, department_id, designation_id } =
      req.body;

    const updateData = {
      first_name,
      last_name,
      mobile,
      department_id,
      designation_id,
      updated_at: knex.fn.now(),
    };

    // ✅ If profile photo uploaded, save FULL PATH
    if (req.file && req.uploadedProfilePath) {
      updateData.profile_photo = req.uploadedProfilePath;
    }

    // Update with company_id filter to prevent cross-company data modification
    const updateResult = await knex("employees")
      .where("id", employeeId)
      .andWhere("company_id", companyId) // ✅ CRITICAL: Filter by company_id
      .update(updateData);

    if (updateResult === 0) {
      console.log(
        "PROFILE UPDATE DEBUG - No employee found to update for company:",
        companyId,
      );
      return res.status(404).json({
        success: false,
        message: "Employee not found or unauthorized",
      });
    }

    const updatedEmployee = await knex("employees")
      .leftJoin("departments", "employees.department_id", "departments.id")
      .leftJoin("designations", "employees.designation_id", "designations.id")
      .where("employees.id", employeeId)
      .andWhere("employees.company_id", companyId) // ✅ CRITICAL: Filter by company_id
      .select(
        "employees.id",
        "employees.employee_id",
        "employees.first_name",
        "employees.last_name",
        "employees.email",
        "employees.mobile",
        "employees.profile_photo", // ✅ FULL PATH
        "employees.department_id",
        "departments.name as department_name",
        "employees.designation_id",
        "designations.name as designation_name",
        "employees.status",
      )
      .first();

    console.log("PROFILE UPDATE DEBUG - Profile updated successfully:", {
      employeeId: updatedEmployee.id,
      name: updatedEmployee.first_name,
      company_id: companyId,
    });

    if (req.file && req.uploadedProfilePath) {
      void warmEmployeeFaceDescriptor(employeeId, companyId).then(
        (result) => {
          if (!result.ready) {
            console.warn("Profile face template was not updated:", result);
          }
        },
        (error) =>
          console.warn("Profile face template update failed:", error.message),
      );
    }

    res.json({
      success: true,
      message: "Profile updated successfully",
      data: updatedEmployee,
    });
  } catch (error) {
    console.error("Error updating profile:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update profile",
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
    const userType = String(req.user?.type || "").toLowerCase();
    const userRole = String(req.user?.role || "").toLowerCase();
    const confirmation = String(req.body?.confirmation || "")
      .trim()
      .toUpperCase();

    if (userType !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Only admin users can delete organization account.",
      });
    }

    if (userRole === "superadmin") {
      return res.status(403).json({
        success: false,
        message: "Superadmin account cannot be deleted from profile.",
      });
    }

    if (!companyId) {
      return res.status(400).json({
        success: false,
        message: "No organization is linked to this admin account.",
      });
    }

    if (confirmation !== "DELETE") {
      return res.status(400).json({
        success: false,
        message: "Please type DELETE to confirm account deletion.",
      });
    }

    const company = await knex("companies").where({ id: companyId }).first();
    if (!company) {
      return res.status(404).json({
        success: false,
        message: "Organization not found.",
      });
    }

    return requestDeletion("company", { company: true })(req, res);
  } catch (error) {
    console.error("Error deleting account and organization:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to delete account and organization data.",
    });
  }
};

module.exports = {
  getMyProfile,
  updateMyProfile,
  deleteMyAccountAndOrganization,
};
