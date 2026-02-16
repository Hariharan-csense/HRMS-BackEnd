// src/controllers/authController.js
const knex = require('../db/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { generateAccessToken, generateRefreshToken } = require('../utils/jwt');
const { transporter } = require('../utils/mailer');
const moment = require('moment');

 const {generateAutoNumber} = require('../utils/generateAutoNumber');
 const { sendRegistrationSuccessMail } = require('../utils/sendRegistrationSuccessMail');


const registerUser = async (req, res) => {

  const {
    name,
    email,
    password,
    confirmPassword,
    role = 'admin',
    department,
    company_name,
    phone
  } = req.body;

  try {

    /* ---------------- VALIDATION ---------------- */
    if (!name || !email || !password || !phone) {
      return res.status(400).json({
        message: 'Name, Email, Phone Number and Password are required'
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

    let createdUser = null;
    let createdCompanyName = null;

    /* ---------------- TRANSACTION ---------------- */
    await knex.transaction(async (trx) => {

      let companyPkId = null;

      /* ---------------- ADMIN → CREATE COMPANY ---------------- */
      if (role === 'admin') {

        if (!company_name?.trim()) {
          throw new Error('Company name is required for admin registration');
        }

        const companyCode = await generateAutoNumber(null, 'company', trx);

        const [newCompanyId] = await trx('companies').insert({
          company_id: companyCode,
          company_name: company_name.trim(),
          legal_name: company_name.trim(),
          gstin_pan: `PENDING_${companyCode}`,
          created_by: null,
          created_at: trx.fn.now(),
          updated_at: trx.fn.now()
        });

        companyPkId = newCompanyId;
        createdCompanyName = company_name.trim();
      }

      /* ---------------- CREATE USER ---------------- */
      const [newUserId] = await trx('users').insert({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        password: hashedPassword,
        role,
        department: department || null,
        company_id: companyPkId,
        phone,
        avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${email}`
      });

      /* ---------------- UPDATE COMPANY CREATED_BY ---------------- */
      if (role === 'admin' && companyPkId) {
        await trx('companies')
          .where({ id: companyPkId })
          .update({ created_by: newUserId });
      }

      /* ---------------- CREATE EMPLOYEE ENTRY FOR ADMIN ---------------- */
      if (role === 'admin' && companyPkId) {

        const [firstName, ...rest] = name.trim().split(' ');
        const lastName = rest.join(' ');

        await trx('employees').insert({
          company_id: companyPkId,
          first_name: firstName || '',
          last_name: lastName || '',
          email: email.trim().toLowerCase(),
          password: hashedPassword,
          role: 'admin',
          doj: new Date(),
          employment_type: 'Full-Time',
          status: 'Active',
          created_at: trx.fn.now(),
          updated_at: trx.fn.now()
        });
      }

      /* ---------------- CREATE DEFAULT LEAVE TYPES FOR NEW COMPANY ---------------- */
      if (role === 'admin' && companyPkId) {
        try {
          // Check if leave types already exist for this company
          const existingLeaveTypes = await trx('leave_types')
            .where({ company_id: companyPkId })
            .first();

          if (!existingLeaveTypes) {
            // Create default leave types for the new company
            await trx('leave_types').insert([
              {
                leave_type_id: 'LT001',
                name: 'Casual Leave',
                is_paid: true,
                annual_limit: 12,
                carry_forward: 5,
                encashable: true,
                description: 'Casual leave for personal work',
                status: 'active',
                company_id: companyPkId
              },
              {
                leave_type_id: 'LT002',
                name: 'Sick Leave',
                is_paid: true,
                annual_limit: 10,
                carry_forward: 0,
                encashable: false,
                description: 'Medical leave',
                status: 'active',
                company_id: companyPkId
              },
              {
                leave_type_id: 'LT003',
                name: 'Annual Leave',
                is_paid: true,
                annual_limit: 20,
                carry_forward: 10,
                encashable: true,
                description: 'Vacation leave',
                status: 'active',
                company_id: companyPkId
              },
              {
                leave_type_id: 'LT004',
                name: 'Unpaid Leave',
                is_paid: false,
                annual_limit: 0,
                carry_forward: 0,
                encashable: false,
                description: 'Leave without pay',
                status: 'active',
                company_id: companyPkId
              },
              {
                leave_type_id: 'LT005',
                name: 'Maternity Leave',
                is_paid: true,
                annual_limit: 180,
                carry_forward: 0,
                encashable: false,
                description: 'Maternity leave for female employees',
                status: 'active',
                company_id: companyPkId
              }
            ]);
            console.log(`Default leave types created for company ${companyPkId}`);
          }
        } catch (leaveTypeError) {
          console.error('Failed to create default leave types:', leaveTypeError);
          // Don't fail registration if leave types creation fails
        }
      }

      /* ---------------- GET USER ---------------- */
      createdUser = await trx('users')
        .where({ id: newUserId })
        .first();

      /* ---------------- CREATE LEAVE BALANCES FOR ADMIN ---------------- */
      if (role === 'admin' && companyPkId) {
        try {
          // Get the employee record that was just created
          const adminEmployee = await trx('employees')
            .where({ 
              company_id: companyPkId,
              email: email.trim().toLowerCase()
            })
            .first();

          if (adminEmployee) {
            // Get active leave types for the company
            const leaveTypes = await trx('leave_types')
              .where({
                company_id: companyPkId,
                status: 'active'
              })
              .select('id', 'name', 'annual_limit');

            const currentYear = new Date().getFullYear();

            for (const leaveType of leaveTypes) {
              // Check if leave balance already exists
              const existingBalance = await trx('leave_balances')
                .where({
                  employee_id: adminEmployee.id,
                  company_id: companyPkId,
                  leave_type_id: leaveType.id,
                  year: currentYear
                })
                .first();

              if (!existingBalance) {
                await trx('leave_balances').insert({
                  company_id: companyPkId,
                  employee_id: adminEmployee.id,
                  leave_type_id: leaveType.id,
                  opening_balance: leaveType.annual_limit,
                  availed: 0,
                  available: leaveType.annual_limit,
                  year: currentYear
                });
                console.log(`Created ${leaveType.name} balance for admin: ${leaveType.annual_limit} days`);
              }
            }
          }
        } catch (leaveBalanceError) {
          console.error('Failed to create leave balances for admin:', leaveBalanceError);
          // Don't fail registration if leave balance creation fails
        }
      }

      /* ---------------- AUTO START FREE TRIAL ---------------- */
      if (role === 'admin' && companyPkId) {

        let defaultPlan = await trx('subscription_plans')
          .where('is_active', true)
          .orderBy('price', 'asc')
          .first();

        if (!defaultPlan) {
          const [newPlanId] = await trx('subscription_plans').insert({
            name: 'Basic Plan',
            description: 'Default plan with basic features',
            price: 999,
            max_users: 10,
            trial_days: 14,
            billing_cycle: 'monthly',
            is_active: true,
            created_at: trx.fn.now(),
            updated_at: trx.fn.now()
          });

          defaultPlan = {
            id: newPlanId,
            trial_days: 7,
            max_users: 10
          };
        }

        const startDate = moment().toDate();
        const trialEndDate = moment()
          .add(defaultPlan.trial_days, 'days')
          .toDate();

        const billingUnit = ['yearly', 'annual', 'year'].includes(String(defaultPlan.billing_cycle || '').toLowerCase())
          ? 'year'
          : 'month';

        const endDate = moment(trialEndDate)
          .add(1, billingUnit)
          .toDate();

        await trx('company_subscriptions').insert({
          company_id: companyPkId,
          plan_id: defaultPlan.id,
          start_date: startDate,
          end_date: endDate,
          trial_end_date: trialEndDate,
          status: 'trial',
          max_users: defaultPlan.max_users,
          next_billing_date: trialEndDate,
          created_at: trx.fn.now(),
          updated_at: trx.fn.now()
        });
      }

    });

    /* ---------------- SEND REGISTRATION MAIL (OUTSIDE TRANSACTION) ---------------- */
    sendRegistrationSuccessMail(
      createdUser,
      role === 'admin' ? createdCompanyName : null
    ).catch(err => console.error('Registration mail failed:', err));

    /* ---------------- TOKEN ---------------- */
    const tokenUser = {
      id: createdUser.id,
      email: createdUser.email,
      role: createdUser.role,
      company_id: createdUser.company_id
    };

    const accessToken = generateAccessToken({ ...tokenUser, type: 'admin' });
    const refreshToken = generateRefreshToken({ ...tokenUser, type: 'admin' });

    /* ---------------- RESPONSE ---------------- */
    res.status(201).json({
      success: true,
      message: 'Registered successfully!',
      note: role === 'admin'
        ? `Company "${createdCompanyName}" created and trial started`
        : null,
      user: {
        id: createdUser.id,
        name: createdUser.name,
        email: createdUser.email,
        role: createdUser.role,
        department: createdUser.department,
        company_id: createdUser.company_id,
        avatar: createdUser.avatar
      },
      token: accessToken,
      accessToken,
      refreshToken
    });

  } catch (error) {

    console.error('Registration error:', error);

    res.status(500).json({
      message: error.message || 'Server error during registration'
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

    // 1. Check users table (Admin / Super Admin)
    user = await knex('users').where({ email }).first();

    if (user) {
      userType = 'admin';
      companyId = user.company_id;
    } else {
      // 2. Check employees table
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

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // 🔥 TOKEN WITH DEPARTMENT & DESIGNATION
    const tokenUser = {
      id: user.id,
      email: user.email,
      role: user.role || 'employee',
      type: userType,
      company_id: companyId,

      // 🔥 IMPORTANT
      department_id: user.department_id || null,
      designation_id: user.designation_id || null
    };

    const accessToken = generateAccessToken(tokenUser);
    const refreshToken = generateRefreshToken(tokenUser);

    const fullName = user.first_name
      ? `${user.first_name} ${user.last_name || ''}`.trim()
      : user.name || 'User';

    // Handle roles for admin users
    let userRoles = [user.role || 'employee'];
    if (userType === 'admin' && user.roles) {
      // If user has stored roles (JSON string), parse it
      try {
        if (typeof user.roles === 'string') {
          userRoles = JSON.parse(user.roles);
        } else if (Array.isArray(user.roles)) {
          userRoles = user.roles;
        }
      } catch (e) {
        console.error('Error parsing user roles:', e);
        userRoles = [user.role || 'employee'];
      }
    }

    res.json({
      success: true,
      message: 'Login successful',
      token: accessToken,
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        name: fullName,
        email: user.email,
        role: user.role || 'employee',
        roles: userRoles,

        // 🔥 PROPER FIELDS
        department_id: user.department_id || null,
        designation_id: user.designation_id || null,

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

const refreshAccessToken = async (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(400).json({ message: 'Refresh token is required' });
  }

  try {
    const decoded = jwt.verify(
      refreshToken,
      process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET
    );

    if (decoded.tokenType && decoded.tokenType !== 'refresh') {
      return res.status(401).json({ message: 'Invalid token type' });
    }

    let user = null;
    let userType = decoded.type;
    let companyId = null;

    if (userType === 'admin') {
      user = await knex('users').where({ id: decoded.id }).first();
      if (!user) {
        return res.status(401).json({ message: 'Admin user not found' });
      }
      companyId = user.company_id;
    } else if (userType === 'employee') {
      user = await knex('employees').where({ id: decoded.id }).first();
      if (!user) {
        return res.status(401).json({ message: 'Employee not found' });
      }
      if (!user.company_id) {
        return res.status(403).json({ message: 'Employee not assigned to any company' });
      }
      companyId = user.company_id;
    } else {
      return res.status(401).json({ message: 'Invalid user type' });
    }

    const tokenUser = {
      id: user.id,
      email: user.email,
      role: user.role || 'employee',
      type: userType,
      company_id: companyId,
      department_id: user.department_id || null,
      designation_id: user.designation_id || null
    };

    const accessToken = generateAccessToken(tokenUser);

    res.json({
      success: true,
      token: accessToken,
      accessToken
    });
  } catch (error) {
    console.error('Refresh token error:', error.message);
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Refresh token expired' });
    }
    return res.status(401).json({ message: 'Invalid refresh token' });
  }
};


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
      // Employee
      await knex('employees').where({ id: userId }).update({ 
        password: hashedPassword
      });
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

// Generate 6-digit OTP
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Check if email exists and send OTP
const initiateForgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }

    // Check if email exists in users table (admins)
    let user = await knex('users').where({ email: email.trim().toLowerCase() }).first();
    
    // If not found in users, check employees table
    if (!user) {
      user = await knex('employees').where({ email: email.trim().toLowerCase() }).first();
    }

    if (!user) {
      return res.status(404).json({ message: 'Email not found in system' });
    }

    // Generate OTP
    const otp = generateOTP();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Check which table the user is in and update with OTP
    let userFoundInTable = 'users'; // default
    const usersTableUser = await knex('users').where({ id: user.id }).first();
    
    if (usersTableUser) {
      // User is in users table (admin)
      await knex('users').where({ id: user.id }).update({
        reset_otp: otp,
        otp_expiry: otpExpiry,
        otp_verified: false
      });
      userFoundInTable = 'users';
    } else {
      // User is in employees table
      await knex('employees').where({ id: user.id }).update({
        reset_otp: otp,
        otp_expiry: otpExpiry,
        otp_verified: false
      });
      userFoundInTable = 'employees';
    }

    // Send OTP via email (using nodemailer)
    const mailOptions = {
      from: `"HRMS Support" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'Password Reset OTP',
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
          <h2>Password Reset Request</h2>
          <p>Hello,</p>
          <p>We received a request to reset your password. Use the OTP below to proceed:</p>
          <div style="background-color: #f0f0f0; padding: 10px; margin: 20px 0; border-radius: 5px;">
            <h1 style="text-align: center; color: #333; letter-spacing: 5px;">${otp}</h1>
          </div>
          <p><strong>Note:</strong> This OTP will expire in 10 minutes.</p>
          <p>If you did not request a password reset, please ignore this email.</p>
          <hr>
          <p style="color: #666; font-size: 12px;">© HRMS System</p>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);

    res.json({
      success: true,
      message: 'OTP sent successfully to your email'
    });

  } catch (error) {
    console.error('Forgot password initiation error:', error);
    res.status(500).json({ message: 'Failed to send OTP. Please try again.' });
  }
};

// Verify OTP
const verifyOTP = async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ message: 'Email and OTP are required' });
    }

    // Check users table (admins)
    let user = await knex('users').where({ email: email.trim().toLowerCase() }).first();
    
    // If not found, check employees
    if (!user) {
      user = await knex('employees').where({ email: email.trim().toLowerCase() }).first();
    }

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Check if OTP exists and is valid
    if (!user.reset_otp || user.reset_otp !== otp) {
      return res.status(400).json({ message: 'Invalid OTP' });
    }

    // Check if OTP has expired
    if (new Date() > new Date(user.otp_expiry)) {
      return res.status(400).json({ message: 'OTP has expired. Please request a new one.' });
    }

    // Mark OTP as verified
    const usersTableUser = await knex('users').where({ id: user.id }).first();
    
    if (usersTableUser) {
      // User is in users table
      await knex('users').where({ id: user.id }).update({
        otp_verified: true
      });
    } else {
      // User is in employees table
      await knex('employees').where({ id: user.id }).update({
        otp_verified: true
      });
    }

    res.json({
      success: true,
      message: 'OTP verified successfully',
      userId: user.id
    });

  } catch (error) {
    console.error('OTP verification error:', error);
    res.status(500).json({ message: 'Failed to verify OTP' });
  }
};

// Reset password with verified OTP
const resetPassword = async (req, res) => {
  try {
    const { email, newPassword, confirmPassword } = req.body;

    if (!email || !newPassword || !confirmPassword) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({ message: 'Passwords do not match' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    // Check users table (admins)
    let user = await knex('users').where({ email: email.trim().toLowerCase() }).first();
    
    // If not found, check employees
    if (!user) {
      user = await knex('employees').where({ email: email.trim().toLowerCase() }).first();
    }

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Verify OTP was verified
    if (!user.otp_verified) {
      return res.status(400).json({ message: 'Please verify OTP first' });
    }

    // Hash new password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    // Update password and clear OTP
    const usersTableUser = await knex('users').where({ id: user.id }).first();
    
    if (usersTableUser) {
      // User is in users table
      await knex('users').where({ id: user.id }).update({
        password: hashedPassword,
        reset_otp: null,
        otp_expiry: null,
        otp_verified: false
      });
    } else {
      // User is in employees table
      await knex('employees').where({ id: user.id }).update({
        password: hashedPassword,
        reset_otp: null,
        otp_expiry: null,
        otp_verified: false
      });
    }

    res.json({
      success: true,
      message: 'Password reset successfully. Please login with your new password.'
    });

  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ message: 'Failed to reset password' });
  }
};

module.exports = {
  login,
  refreshAccessToken,
  registerUser,
  changePassword,
  logout,
  initiateForgotPassword,
  verifyOTP,
  resetPassword
};
