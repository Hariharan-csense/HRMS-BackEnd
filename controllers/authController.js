// src/controllers/authController.js
const knex = require('../db/db');
const bcrypt = require('bcryptjs');
const { generateToken } = require('../utils/jwt');
const {generateAutoNumber} = require('../utils/generateAutoNumber');


// const registerUser = async (req, res) => {
//   const {
//     name,
//     email,
//     password,
//     confirmPassword,
//     role = 'employee',
//     department,
//     company_name // ← Admin register பண்ணும்போது company name கேட்கலாம் (optional)
//   } = req.body;

//   try {
//     // Validation
//     if (!name || !email || !password) {
//       return res.status(400).json({ message: 'Name, Email and Password are required' });
//     }

//     if (password.length < 6) {
//       return res.status(400).json({ message: 'Password must be at least 6 characters' });
//     }

//     if (password !== confirmPassword) {
//       return res.status(400).json({ message: 'Passwords do not match' });
//     }

//     // Check if email exists
//     const existingUser = await knex('users').where({ email }).first();
//     if (existingUser) {
//       return res.status(400).json({ message: 'Email already registered' });
//     }

//     // Hash password
//     const salt = await bcrypt.genSalt(10);
//     const hashedPassword = await bcrypt.hash(password, salt);

//     let companyId = null;

//     // If role is admin, create company automatically
//     // If role is admin, create company automatically
// if (role === 'admin') {
//   if (!company_name?.trim()) {
//     return res.status(400).json({
//       message: 'Company name is required for admin registration'
//     });
//   }

//   const [newCompanyId] = await knex('companies').insert({
//     company_name: company_name.trim(),
//     legal_name: company_name.trim(), // optional but recommended
//     created_at: knex.fn.now(),
//     updated_at: knex.fn.now()
//   });

//   companyId = newCompanyId;
// }


//     // Insert new user
//     const [newUserId] = await knex('users').insert({
//       name: name.trim(),
//       email: email.trim().toLowerCase(),
//       password: hashedPassword,
//       role,
//       department: department || null,
//       company_id: companyId, // ← Admin-க்கு company_id assign
//       avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${email}`
//     });

//     const newUser = await knex('users').where({ id: newUserId }).first();

//     // Update company created_by if admin
//     if (role === 'admin' && companyId) {
//       await knex('companies').where({ id: companyId }).update({
//         created_by: newUserId
//       });
//     }

//     // Generate JWT token
//     const token = generateToken({
//       id: newUser.id,
//       email: newUser.email,
//       role: newUser.role,
//       company_id: newUser.company_id
//     });

//     res.status(201).json({
//       success: true,
//       message: `User "${name}" registered successfully!`,
//       note: role === 'admin' ? `Company "${company_name}" created and assigned to you.` : null,
//       user: {
//         id: newUser.id,
//         name: newUser.name,
//         email: newUser.email,
//         role: newUser.role,
//         roles: [newUser.role],
//         department: newUser.department,
//         company_id: newUser.company_id,
//         avatar: newUser.avatar
//       },
//       token
//     });

//   } catch (error) {
//     console.error('Registration error:', error);
//     res.status(500).json({ message: 'Server error during registration' });
//   }
// };

const registerUser = async (req, res) => {
  const {
    name,
    email,
    password,
    confirmPassword,
    role = 'employee',
    department,
    company_name
  } = req.body;

  try {
    /* ---------------- VALIDATION ---------------- */
    if (!name || !email || !password) {
      return res.status(400).json({
        message: 'Name, Email and Password are required'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        message: 'Password must be at least 6 characters'
      });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({
        message: 'Passwords do not match'
      });
    }

    const existingUser = await knex('users')
      .where({ email: email.trim().toLowerCase() })
      .first();

    if (existingUser) {
      return res.status(400).json({
        message: 'Email already registered'
      });
    }

    /* ---------------- PASSWORD HASH ---------------- */
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    let companyPkId = null;

    /* ---------------- ADMIN → AUTO CREATE COMPANY ---------------- */
    if (role === 'admin') {
      if (!company_name?.trim()) {
        return res.status(400).json({
          message: 'Company name is required for admin registration'
        });
      }

      // ✅ IMPORTANT FIX HERE
      const companyCode = await generateAutoNumber(null, 'company');

      const [newCompanyId] = await knex('companies').insert({
        company_id: companyCode,      // COMP001
        company_name: company_name.trim(),
        legal_name: company_name.trim(),
        created_at: knex.fn.now(),
        updated_at: knex.fn.now()
      });

      companyPkId = newCompanyId;
    }

    /* ---------------- CREATE USER ---------------- */
    const [newUserId] = await knex('users').insert({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      password: hashedPassword,
      role,
      department: department || null,
      company_id: companyPkId,
      avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${email}`
    });

    /* ---------------- UPDATE COMPANY CREATED_BY ---------------- */
    if (role === 'admin' && companyPkId) {
      await knex('companies')
        .where({ id: companyPkId })
        .update({
          created_by: newUserId
        });
    }

    /* ---------------- FETCH USER ---------------- */
    const newUser = await knex('users')
      .where({ id: newUserId })
      .first();

    /* ---------------- JWT TOKEN ---------------- */
    const token = generateToken({
      id: newUser.id,
      email: newUser.email,
      role: newUser.role,
      company_id: newUser.company_id
    });

    /* ---------------- RESPONSE ---------------- */
    res.status(201).json({
      success: true,
      message: ` registered successfully!`,
      note: role === 'admin'
        ? `Company "${company_name}" created and assigned to you.`
        : null,
      user: {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        role: newUser.role,
        roles: [newUser.role],
        department: newUser.department,
        company_id: newUser.company_id,
        avatar: newUser.avatar
      },
      token
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      message: 'Server error during registration'
    });
  }
};



const login = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required' });
  }

  try {
    let user = null;
    let userType = null;
    let companyId = null;

    // 1. First check in users table (for Super Admin or Company Admins)
    user = await knex('users').where({ email }).first();

    if (user) {
      // Admin user (from users table)
      userType = 'admin';
      companyId = user.company_id; // may be null for super admin
    } else {
      // 2. Check in employees table
      user = await knex('employees').where({ email }).first();
      if (!user) {
        return res.status(401).json({ message: 'Invalid email or password' });
      }

      userType = 'employee';
      companyId = user.company_id;

      if (!companyId) {
        return res.status(403).json({ message: 'Employee not assigned to any company' });
      }
    }

    // Compare password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Generate token with company_id
    const token = generateToken({
      id: user.id,
      email: user.email,
      role: user.role || 'employee',
      type: userType,
      company_id: companyId // ← மிக முக்கியம்!
    });

    // Prepare response user data
    const fullName = user.first_name 
      ? `${user.first_name} ${user.last_name || ''}`.trim()
      : user.name || 'User';

    res.json({
      success: true,
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        name: fullName,
        email: user.email,
        role: user.role || 'employee',
        roles: [user.role || 'employee'],
        department: user.department || user.department_id || null,
        company_id: companyId,
        avatar: user.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${email}`,
        type: userType
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Server error during login' });
  }
};

// Change Password - works for both admin & employee
const changePassword = async (req, res) => {
  if (!req.user || !req.user.id) {
    return res.status(401).json({ message: 'Not authorized' });
  }

  const userId = req.user.id;
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ message: 'Current and new password are required' });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ message: 'New password must be at least 6 characters' });
  }

  try {
    let user;

    // Check if admin (users table)
    if (req.user.type === 'admin') {
      user = await knex('users').where({ id: userId }).first();
    } else {
      // Employee
      user = await knex('employees').where({ id: userId }).first();
    }

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Verify current password
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Current password is incorrect' });
    }

    // Hash new password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    // Update password in correct table
    if (req.user.type === 'admin') {
      await knex('users').where({ id: userId }).update({ password: hashedPassword });
    } else {
      await knex('employees').where({ id: userId }).update({ password: hashedPassword });
    }

    res.json({ 
      success: true, 
      message: 'Password changed successfully' 
    });

  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Logout - Stateless JWT, so just client-side
const logout = async (req, res) => {
  res.json({
    success: true,
    message: 'Logged out successfully. Please clear token from client.'
  });
};

module.exports = {
  login,
  changePassword,
  logout
};

module.exports = { login, registerUser, changePassword, logout };



