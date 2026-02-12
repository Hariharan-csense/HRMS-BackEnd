// src/controllers/employeeController.js
const knex = require('../db/db');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { sendEmployeeWelcomeMail } = require('../utils/sendEmployeeWelcomeMail');
const {initializeLeaveBalance, calculateLeaveForConfirmedEmployee} = require('../controllers/leaveController');
const cleanupFiles = (files) => {
  if (files) {
    Object.values(files).flat().forEach(file => {
      const filePath = file.path;
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    });
  }
};
const addEmployee = async (req, res) => {
  const companyId = req.user.company_id;

  if (!companyId) {
    cleanupFiles(req.files);
    return res.status(400).json({ message: 'You are not assigned to any company' });
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
    emergency_contact_name,
    emergency_contact_phone,
    doj,
    employment_type,
    shift_id = null,
    department_id,
    designation_id,
    location_office,
    status = 'Active',
    salary = 0,
    aadhaar,
    pan,
    uan,
    esic,
    account_holder_name,
    bank_name,
    account_number,
    ifsc_code,
    role = 'employee'
  } = req.body;

  if (!employee_id || !first_name || !last_name || !email || !doj) {
    cleanupFiles(req.files);
    return res.status(400).json({
      message: 'Employee ID, First Name, Last Name, Email and Date of Joining are required'
    });
  }

  try {
    const depId = department_id ? parseInt(department_id) : null;
    const desigId = designation_id ? parseInt(designation_id) : null;
    const normalizedRole = role.toLowerCase();

    // ✅ Only one HR per company
    if (normalizedRole === 'hr') {
      const existingHR = await knex('employees')
        .where({ company_id: companyId, role: 'hr' })
        .whereNot(id ? { id } : {})
        .first();

      if (existingHR) {
        cleanupFiles(req.files);
        return res.status(400).json({
          message: `This company already has an HR: ${existingHR.first_name} ${existingHR.last_name || ''}. Only one HR is allowed per company.`
        });
      }
    }

// --------------------
// VALIDATE SHIFT
// --------------------
let finalShiftId = null;

if (shift_id) {
  try {
    const shift = await knex('shifts')
      .where({
        id: shift_id,
        company_id: companyId
      })
      .first();

    if (!shift) {
      cleanupFiles(req.files);
      return res.status(400).json({
        message: 'Invalid shift selected'
      });
    }

    finalShiftId = shift.id;
  } catch (error) {
    console.error('Error validating shift:', error);
    cleanupFiles(req.files);
    return res.status(500).json({
      message: 'Error validating shift. Please try again.'
    });
  }
} else {
  // Shift is optional - set to null if not provided
  finalShiftId = null;
}


    let employeeId;
    let message;

    // ======================
    // UPDATE EMPLOYEE
    // ======================
    if (id) {
      const existing = await knex('employees')
        .where({ id, company_id: companyId })
        .first();

      if (!existing) {
        cleanupFiles(req.files);
        return res.status(404).json({ message: 'Employee not found or access denied' });
      }

      await knex('employees')
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
    emergency_contact_name: emergency_contact_name || null,
    emergency_contact_phone: emergency_contact_phone || null,
    doj,
    employment_type: employment_type || 'Full-Time',
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
    role: normalizedRole
  });

      employeeId = id;
      message = 'Employee updated successfully!';
    }

    // ======================
    // CREATE EMPLOYEE
    // ======================
    else {
      const emailExists = await knex('employees')
        .whereRaw('LOWER(email) = ? AND company_id = ?', [email.toLowerCase(), companyId])
        .first();

      if (emailExists) {
        cleanupFiles(req.files);
        return res.status(400).json({ message: 'Email already exists in your company' });
      }

      const empIdExists = await knex('employees')
        .whereRaw('LOWER(employee_id) = ? AND company_id = ?', [employee_id.toLowerCase(), companyId])
        .first();

      if (empIdExists) {
        cleanupFiles(req.files);
        return res.status(400).json({ message: 'Employee ID already exists in your company' });
      }

      // Generate temporary password
      const tempPassword = Math.random().toString(36).slice(2, 10).toUpperCase() + Math.random().toString(36).slice(2, 4).toUpperCase() + '!';
      const hashedPassword = await bcrypt.hash(tempPassword, 10);

     const [newId] = await knex('employees').insert({
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
  emergency_contact_name: emergency_contact_name || null,
  emergency_contact_phone: emergency_contact_phone || null,
  doj,
  employment_type: employment_type || 'Full-Time',
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
  password: hashedPassword,
  role: normalizedRole
});

      console.log(`[EMPLOYEE CREATION DEBUG] New Employee ID: ${newId}, Email: ${email.trim().toLowerCase()}, Temp Password: ${tempPassword}`);

      employeeId = newId;

      // Send welcome email with temporary password
      try {
        await sendEmployeeWelcomeMail({
          name: `${first_name.trim()} ${last_name.trim()}`,
          email: email.trim().toLowerCase(),
          password: tempPassword
        });
        message = 'Employee added successfully! Welcome email sent with temporary password.';
      } catch (emailError) {
        console.error('Error sending welcome email:', emailError);
        message = 'Employee added successfully! Warning: Failed to send welcome email.';
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
    company_id: companyId,          // 🔥 FIX
    employee_id: employeeId,
    account_holder_name: account_holder_name || null,
    bank_name: bank_name || null,
    account_number,
    ifsc_code
  };

  const existingBank = await knex('employee_bank_details')
    .where({
      employee_id: employeeId,
      company_id: companyId
    })
    .first();

  if (existingBank) {
    await knex('employee_bank_details')
      .where({
        employee_id: employeeId,
        company_id: companyId
      })
      .update(bankData);
  } else {
    await knex('employee_bank_details').insert(bankData);
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
  Object.keys(req.files).forEach(fieldname => {
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
  const documents = allFiles.map(file => ({
    company_id: companyId,
    employee_id: employeeId,
    filename: file.originalname,
    fieldname: file.fieldname,        // photo, id_proof, etc.
    file_path: file.path.replace(/\\/g, '/'), // Windows path fix if needed
    mimetype: file.mimetype,
    size: file.size
  }));

  await knex('employee_documents').insert(documents);
  console.log(`Successfully inserted ${allFiles.length} documents for employee ${employeeId}`);
} else {
  console.log("No files uploaded for this employee");
}


    // ======================
    // ASSIGN DEPARTMENT HEAD
    // ======================
    if ((normalizedRole === 'manager' || normalizedRole === 'hr') && depId) {
      await knex('departments')
        .where({ id: depId, company_id: companyId })
        .update({
          head_id: employeeId,
          head_name: `${first_name.trim()} ${last_name.trim()}`
        });
    }

    const finalEmployee = await knex('employees').where({ id: employeeId }).first();

    res.status(id ? 200 : 201).json({
      success: true,
      message,
      employee: finalEmployee
    });

  } catch (error) {
    cleanupFiles(req.files);
    console.error('Employee operation error:', error);
    res.status(500).json({ message: 'Server error' });
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
    let managerDepartmentId = null;

    // 🔐 If MANAGER → Get department_id from employees table
    if (req.user.role === "manager") {
      const manager = await knex("employees")
        .select("department_id")
        .where("id", req.user.id)   // employees.id
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
      .select(
        "e.*",
        "d.name as department_name",
        "des.name as designation_name"
      )
      .where("e.company_id", companyId);

    // 🔐 ROLE BASED ACCESS

    // MANAGER → Same department employees
    if (req.user.role === "manager") {
      baseQuery.where("e.department_id", managerDepartmentId);
    }

    // NON-ADMIN & NON-MANAGER → Only self
    if (
      req.user.role !== "admin" &&
      req.user.role !== "manager"
    ) {
      baseQuery.where("e.id", req.user.id);
    }

    // ADMIN → No filter (all employees)

    const employees = await baseQuery;

    // 2️⃣ Attach bank details & documents
    const result = await Promise.all(
      employees.map(async (emp) => {
        const bankDetails = await knex("employee_bank_details")
          .where({ employee_id: emp.id })
          .first();

        const documents = await knex("employee_documents")
          .where({ employee_id: emp.id });

        return {
          ...emp,
          department: emp.department_name,
          designation: emp.designation_name,
          status: emp.status,
          bankDetails,
          documents,
        };
      })
    );

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
    return res.status(400).json({ message: 'You are not assigned to any company' });
  }

  const { id } = req.params;

  try {
    const employee = await knex('employees')
      .leftJoin('departments', 'employees.department_id', 'departments.id')
      .leftJoin('designations', 'employees.designation_id', 'designations.id')
      .leftJoin('employee_bank_details', 'employees.id', 'employee_bank_details.employee_id')
      .where('employees.id', id)
      .where('employees.company_id', companyId)
      .select(
        'employees.*',
        'departments.name as department_name',
        'designations.name as designation_name',
        'employee_bank_details.account_holder_name',
        'employee_bank_details.bank_name',
        'employee_bank_details.account_number',
        'employee_bank_details.ifsc_code'
      )
      .first();

    if (!employee) {
      return res.status(404).json({ message: 'Employee not found or access denied' });
    }

    // Get documents
    const docs = await knex('employee_documents').where({ employee_id: employee.id });
    const documents = docs.map(doc => ({
      type: doc.type,
      file_url: `${doc.file_path}`,
      original_name: doc.original_name
    }));

    const photo = documents.find(d => d.type === 'photo');

    res.json({
      success: true,
      employee: {
        ...employee,
        photo_url: photo ? photo.file_url : null,
        documents
      }
    });

  } catch (error) {
    console.error('Get employee by ID error:', error);
    res.status(500).json({ message: 'Server error' });
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
    return res.status(400).json({ message: 'You are not assigned to any company' });
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
    emergency_contact_name,
    emergency_contact_phone,
    doj,
    employment_type,
    department_id,
    designation_id,
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
  } = req.body;

  try {
    const employee = await knex('employees')
      .where({ id, company_id: companyId })
      .first();

    if (!employee) {
      cleanupFiles(req.files);
      return res.status(404).json({ message: 'Employee not found or access denied' });
    }

    // Build dynamic update object - only include provided fields
    const updateData = {};

    if (employee_id !== undefined) updateData.employee_id = employee_id.trim().toUpperCase();
    if (first_name !== undefined) updateData.first_name = first_name.trim();
    if (last_name !== undefined) updateData.last_name = last_name.trim();
    if (gender !== undefined) updateData.gender = gender || null;
    if (dob !== undefined) updateData.dob = dob || null;
    if (blood_group !== undefined) updateData.blood_group = blood_group || null;
    if (marital_status !== undefined) updateData.marital_status = marital_status || null;
    if (email !== undefined) {
      // Email duplicate check if changing email
      const emailExists = await knex('employees')
        .whereRaw('LOWER(email) = ? AND company_id = ?', [email.toLowerCase(), companyId])
        .whereNot({ id })
        .first();

      if (emailExists) {
        cleanupFiles(req.files);
        return res.status(400).json({ message: 'Email already exists in your company' });
      }
      updateData.email = email.trim().toLowerCase();
    }
    if (mobile !== undefined) updateData.mobile = mobile || null;
    if (emergency_contact_name !== undefined) updateData.emergency_contact_name = emergency_contact_name || null;
    if (emergency_contact_phone !== undefined) updateData.emergency_contact_phone = emergency_contact_phone || null;
    if (doj !== undefined) updateData.doj = doj;
    if (employment_type !== undefined) updateData.employment_type = employment_type;
    if (department_id !== undefined) updateData.department_id = department_id ? parseInt(department_id) : null;
    if (designation_id !== undefined) updateData.designation_id = designation_id ? parseInt(designation_id) : null;
    if (location_office !== undefined) updateData.location_office = location_office || null;
    if (status !== undefined) updateData.status = status;
    if (salary !== undefined) updateData.salary = salary ? parseFloat(salary) : null;
    if (aadhaar !== undefined) updateData.aadhaar = aadhaar || null;
    if (pan !== undefined) updateData.pan = pan || null;
    if (uan !== undefined) updateData.uan = uan || null;
    if (esic !== undefined) updateData.esic = esic || null;
    if (shift_id !== undefined) updateData.shift_id = shift_id ? parseInt(shift_id) : null;

    // Role handling with HR restriction
    if (role !== undefined) {
      const normalizedRole = role ? role.toLowerCase() : employee.role;

      if (normalizedRole === 'hr') {
        const existingHR = await knex('employees')
          .where({ company_id: companyId, role: 'hr' })
          .whereNot({ id })
          .first();

        if (existingHR) {
          cleanupFiles(req.files);
          return res.status(400).json({
            message: `This company already has an HR: ${existingHR.first_name} ${existingHR.last_name || ''}. Only one HR is allowed per company.`
          });
        }
      }
      updateData.role = normalizedRole;
    }

    // Check if there's anything to update
    const hasEmployeeUpdates = Object.keys(updateData).length > 0;
    const hasBankUpdates = account_number || account_holder_name || bank_name || ifsc_code;
    const hasFiles = req.files && Object.keys(req.files).length > 0;

    if (!hasEmployeeUpdates && !hasBankUpdates && !hasFiles) {
      return res.status(400).json({ message: 'No data provided to update' });
    }

    // Update employee record if there are changes
    if (hasEmployeeUpdates) {
      await knex('employees')
        .where({ id })
        .update(updateData);

      // Check if employee transitioned from probation to full-time
      if (updateData.employment_type === 'Full-Time' && employee.employment_type === 'Probation') {
        console.log(`Employee ${id} transitioned from probation to full-time - calculating leave`);
        const leaveResult = await calculateLeaveForConfirmedEmployee(id, companyId);
        if (leaveResult.success) {
          console.log('Leave calculated successfully for confirmed employee');
        } else {
          console.error('Failed to calculate leave:', leaveResult.message);
        }
      }
    }


// --------------------
// VALIDATE SHIFT
// --------------------
let finalShiftId = null;

if (shift_id) {
  const shift = await knex('shifts')
    .where({
      id: shift_id,
      company_id: companyId
    })
    .first();

  if (!shift) {
    cleanupFiles(req.files);
    return res.status(400).json({
      message: 'Invalid shift selected'
    });
  }

  finalShiftId = shift.id;
} else {
  cleanupFiles(req.files);
  return res.status(400).json({
    message: 'Shift is required'
  });
}

    // Handle bank details (optional update)
    if (hasBankUpdates) {
      const bankData = {
        company_id: companyId,
        employee_id: id,
        account_holder_name: account_holder_name || null,
        bank_name: bank_name || null,
        account_number: account_number || null,
        ifsc_code: ifsc_code || null
      };

      const existingBank = await knex('employee_bank_details').where({ employee_id: id }).first();
      if (existingBank) {
        await knex('employee_bank_details').where({ employee_id: id }).update(bankData);
      } else if (account_number && ifsc_code) {
        await knex('employee_bank_details').insert(bankData);
      }
    }

    // Handle document uploads
    // Handle document uploads
let allFiles = [];

if (req.files) {
  console.log("req.files in update:", req.files);

  Object.keys(req.files).forEach(fieldname => {
    const files = req.files[fieldname];
    if (Array.isArray(files)) {
      allFiles = allFiles.concat(files);
    } else if (files) {
      allFiles.push(files);
    }
  });
}

if (allFiles.length > 0) {
  const documents = allFiles.map(file => ({
    company_id: companyId,
    employee_id: id,
    filename: file.originalname,
    fieldname: file.fieldname,
    file_path: file.path.replace(/\\/g, '/'),
    mimetype: file.mimetype,
    size: file.size
  }));

  await knex('employee_documents').insert(documents);
  console.log(`Uploaded ${allFiles.length} new documents for employee ${id}`);
}

    // Department head assignment (only if role or department changed)
    const finalRole = updateData.role || employee.role;
    const finalDeptId = updateData.department_id !== undefined ? updateData.department_id : employee.department_id;

    if ((finalRole === 'manager' || finalRole === 'hr') && finalDeptId) {
      await knex('departments')
        .where({ id: finalDeptId, company_id: companyId })
        .update({
          head_id: id,
          head_name: `${updateData.first_name || employee.first_name} ${updateData.last_name || employee.last_name}`
        });
    } else if (updateData.role || updateData.department_id !== undefined) {
      // Remove head role if no longer manager/hr or department changed
      await knex('departments')
        .where({ head_id: id, company_id: companyId })
        .update({ head_id: null, head_name: null });
    }

    const updatedEmployee = await knex('employees').where({ id }).first();

    res.json({
      success: true,
      message: 'Employee updated successfully!',
      employee: updatedEmployee
    });

  } catch (error) {
    cleanupFiles(req.files);
    console.error('Update employee error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};


// Delete Employee (company scoped)
const deleteEmployee = async (req, res) => {
  const companyId = req.user.company_id;
  if (!companyId) {
    return res.status(400).json({ message: 'You are not assigned to any company' });
  }

  const { id } = req.params;

  try {
    const employee = await knex('employees')
      .where({ id, company_id: companyId })
      .first();

    if (!employee) {
      return res.status(404).json({ message: 'Employee not found or access denied' });
    }

    // Delete document files
    const docs = await knex('employee_documents').where({ employee_id: id });
    docs.forEach(doc => {
      const filePath = path.join(__dirname, '..', '..', doc.file_path);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    });

    // Delete related records
    await knex('employee_documents').where({ employee_id: id }).del();
    await knex('employee_bank_details').where({ employee_id: id }).del();
    await knex('employees').where({ id }).del();

    res.json({
      success: true,
      message: 'Employee deleted successfully!'
    });

  } catch (error) {
    console.error('Delete employee error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = {
  addEmployee,
  getEmployees,
  getEmployeeById,
  updateEmployee,
  deleteEmployee
};