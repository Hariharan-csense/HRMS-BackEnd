// src/controllers/authController.js

const knex = require("../db/db");

const bcrypt = require("bcryptjs");

const jwt = require("jsonwebtoken");

const { generateAccessToken, generateRefreshToken } = require("../utils/jwt");

const { transporter } = require("../utils/mailer");

const moment = require("moment");

const { generateAutoNumber } = require("../utils/generateAutoNumber");

const {
  sendRegistrationSuccessMail,
} = require("../utils/sendRegistrationSuccessMail");

const {
  buildEmployeeDefaultModules,
  buildFullAccessModules,
} = require("../config/rbacDefaults");

const { normalizeModulesPayload } = require("../utils/rbac");

const parseCookies = (cookieHeader = "") => {
  return String(cookieHeader || "")
    .split(";")

    .map((part) => part.trim())

    .filter(Boolean)

    .reduce((acc, part) => {
      const separatorIndex = part.indexOf("=");

      if (separatorIndex === -1) {
        return acc;
      }

      const key = part.slice(0, separatorIndex).trim();

      const value = part.slice(separatorIndex + 1).trim();

      if (key) {
        acc[key] = decodeURIComponent(value);
      }

      return acc;
    }, {});
};

const isProduction = process.env.NODE_ENV === "production";

const cookieSameSite = isProduction ? "none" : "lax";

const cookieSecure = isProduction;

const cookieHttpOnly = process.env.COOKIE_HTTP_ONLY !== "false";

const buildCookieOptions = (maxAge) => ({
  httpOnly: cookieHttpOnly,

  secure: cookieSecure,

  sameSite: cookieSameSite,

  path: "/",

  maxAge,
});

const setAuthCookies = (res, accessToken, refreshToken) => {
  res.cookie("accessToken", accessToken, buildCookieOptions(30 * 60 * 1000));

  res.cookie(
    "refreshToken",
    refreshToken,
    buildCookieOptions(7 * 24 * 60 * 60 * 1000),
  );
};

const clearAuthCookies = (res) => {
  const clearOptions = {
    httpOnly: cookieHttpOnly,

    secure: cookieSecure,

    sameSite: cookieSameSite,

    path: "/",
  };

  res.clearCookie("accessToken", clearOptions);

  res.clearCookie("refreshToken", clearOptions);

  res.clearCookie("accessTokenDebug", { ...clearOptions, httpOnly: false });

  res.clearCookie("refreshTokenDebug", { ...clearOptions, httpOnly: false });
};

const getEffectiveRolesForUser = async (user, userType, companyId) => {
  if (userType === "admin") {
    let userRoles = [user.role || "admin"];

    if (user.roles) {
      try {
        if (typeof user.roles === "string") {
          userRoles = JSON.parse(user.roles);
        } else if (Array.isArray(user.roles)) {
          userRoles = user.roles;
        }
      } catch (e) {
        console.error("Error parsing user roles:", e);

        userRoles = [user.role || "admin"];
      }
    }

    if (user.role && !userRoles.includes(user.role)) {
      userRoles = [user.role, ...userRoles];
    }

    return userRoles.length ? userRoles : [user.role || "admin"];
  }

  const assignedRoles = await knex("role_assignments")
    .join("roles", "role_assignments.role_id", "roles.id")

    .where({
      "role_assignments.employee_id": user.id,

      "role_assignments.company_id": companyId,

      "role_assignments.status": "Active",
    })

    .select("roles.name")

    .orderBy("role_assignments.assigned_date", "desc");

  const roleSet = new Set();

  assignedRoles.forEach((entry) => {
    const roleName = String(entry?.name || "").trim();

    if (roleName) roleSet.add(roleName);
  });

  if (user.role) {
    roleSet.add(user.role);
  }

  return roleSet.size ? [...roleSet] : [user.role || "employee"];
};

const registerUser = async (req, res) => {
  const {
    name,

    email,

    password,

    confirmPassword,

    department,

    company_name,

    phone,
  } = req.body;

  const role = "admin";

  try {
    /* ---------------- VALIDATION ---------------- */

    if (!name || !email || !password || !phone) {
      return res.status(400).json({
        message: "Name, Email, Phone Number and Password are required",
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        message: "Password must be at least 6 characters",
      });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({
        message: "Passwords do not match",
      });
    }

    const existingUser = await knex("users")
      .where({ email: email.trim().toLowerCase() })

      .first();

    if (existingUser) {
      return res.status(400).json({
        message: "Email already registered",
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

      if (role === "admin") {
        if (!company_name?.trim()) {
          throw new Error("Company name is required for admin registration");
        }

        const companyCode = await generateAutoNumber(null, "company", trx);

        const [newCompanyId] = await trx("companies").insert({
          company_id: companyCode,

          company_name: company_name.trim(),

          legal_name: company_name.trim(),

          gstin_pan: `PENDING_${companyCode}`,

          created_by: null,

          created_at: trx.fn.now(),

          updated_at: trx.fn.now(),
        });

        companyPkId = newCompanyId;

        createdCompanyName = company_name.trim();

        const defaultRoleDefinitions = [
          {
            name: "Admin",
            modules: buildFullAccessModules(),
          },
          {
            name: "CEO",
            modules: buildFullAccessModules(),
          },
          {
            name: "Employee",
            modules: buildEmployeeDefaultModules(),
          },
        ];

        let nextRoleNumber = 1;

        const lastRole = await trx("roles")
          .where({ company_id: companyPkId })
          .orderBy("id", "desc")
          .first();

        if (lastRole?.role_id) {
          nextRoleNumber =
            parseInt(String(lastRole.role_id).replace("ROLE", ""), 10) + 1;
        }

        for (const defaultRole of defaultRoleDefinitions) {
          const existingRole = await trx("roles")
            .whereRaw("LOWER(name) = ? AND company_id = ?", [
              defaultRole.name.toLowerCase(),
              companyPkId,
            ])
            .first();

          if (existingRole) continue;

          const role_id = `ROLE${String(nextRoleNumber).padStart(3, "0")}`;
          nextRoleNumber += 1;

          await trx("roles").insert({
            company_id: companyPkId,
            role_id,
            name: defaultRole.name,
            approval_authority: "",
            data_visibility: "",
            modules: JSON.stringify(
              normalizeModulesPayload(defaultRole.modules),
            ),
            description: null,
            created_at: trx.fn.now(),
            updated_at: trx.fn.now(),
          });
        }
      }

      /* ---------------- CREATE USER ---------------- */

      const [newUserId] = await trx("users").insert({
        name: name.trim(),

        email: email.trim().toLowerCase(),

        password: hashedPassword,

        role,

        department: department || null,

        company_id: companyPkId,

        phone,

        avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${email}`,
      });

      /* ---------------- UPDATE COMPANY CREATED_BY ---------------- */

      if (role === "admin" && companyPkId) {
        await trx("companies")
          .where({ id: companyPkId })

          .update({ created_by: newUserId });
      }

      /* ---------------- CREATE EMPLOYEE ENTRY FOR ADMIN ---------------- */

      if (role === "admin" && companyPkId) {
        const [firstName, ...rest] = name.trim().split(" ");

        const lastName = rest.join(" ");

        await trx("employees").insert({
          company_id: companyPkId,

          first_name: firstName || "",

          last_name: lastName || "",

          email: email.trim().toLowerCase(),

          password: hashedPassword,

          role: "admin",

          doj: new Date(),

          employment_type: "Full-Time",

          status: "Active",

          created_at: trx.fn.now(),

          updated_at: trx.fn.now(),
        });
      }

      /* ---------------- CREATE DEFAULT LEAVE TYPES FOR NEW COMPANY ---------------- */

      if (role === "admin" && companyPkId) {
        try {
          // Check if leave types already exist for this company

          const existingLeaveTypes = await trx("leave_types")
            .where({ company_id: companyPkId })

            .first();

          if (!existingLeaveTypes) {
            // Create default leave types for the new company

            await trx("leave_types").insert([
              {
                leave_type_id: "LT001",

                name: "Casual Leave",

                is_paid: true,

                annual_limit: 12,

                carry_forward: 5,

                encashable: true,

                description: "Casual leave for personal work",

                status: "active",

                company_id: companyPkId,
              },

              {
                leave_type_id: "LT002",

                name: "Sick Leave",

                is_paid: true,

                annual_limit: 10,

                carry_forward: 0,

                encashable: false,

                description: "Medical leave",

                status: "active",

                company_id: companyPkId,
              },

              {
                leave_type_id: "LT003",

                name: "Annual Leave",

                is_paid: true,

                annual_limit: 20,

                carry_forward: 10,

                encashable: true,

                description: "Vacation leave",

                status: "active",

                company_id: companyPkId,
              },

              {
                leave_type_id: "LT004",

                name: "Unpaid Leave",

                is_paid: false,

                annual_limit: 0,

                carry_forward: 0,

                encashable: false,

                description: "Leave without pay",

                status: "active",

                company_id: companyPkId,
              },

              {
                leave_type_id: "LT005",

                name: "Maternity Leave",

                is_paid: true,

                annual_limit: 180,

                carry_forward: 0,

                encashable: false,

                description: "Maternity leave for female employees",

                status: "active",

                company_id: companyPkId,
              },
            ]);

            console.log(
              `Default leave types created for company ${companyPkId}`,
            );
          }
        } catch (leaveTypeError) {
          console.error(
            "Failed to create default leave types:",
            leaveTypeError,
          );

          // Don't fail registration if leave types creation fails
        }
      }

      /* ---------------- GET USER ---------------- */

      createdUser = await trx("users")
        .where({ id: newUserId })

        .first();

      /* ---------------- CREATE FREE TRIAL SUBSCRIPTION FOR NEW COMPANY ---------------- */

      if (role === "admin" && companyPkId) {
        try {
          // Check if company already has a subscription

          const existingSubscription = await trx("company_subscriptions")
            .where("company_id", companyPkId)

            .first();

          if (!existingSubscription) {
            // Get the best available plan for trial (highest trial days, or create a default)

            let plan = await trx("subscription_plans")
              .where("is_active", true)

              .orderBy("trial_days", "desc")

              .first();

            if (!plan) {
              const planColumns = await trx("subscription_plans").columnInfo();

              const monthlyPriceField = planColumns.monthly_price
                ? "monthly_price"
                : "price";

              const hasYearlyPrice = Boolean(planColumns.yearly_price);

              const hasStorage = Boolean(planColumns.storage_gb);

              const hasMaxUsers = Boolean(planColumns.max_users);

              const defaultPlanData = {
                name: "Trial",

                description: "Trial plan (auto-created)",

                trial_days: 30,

                is_active: true,

                created_at: trx.fn.now(),

                updated_at: trx.fn.now(),
              };

              defaultPlanData[monthlyPriceField] = 0;

              if (hasYearlyPrice) defaultPlanData.yearly_price = 0;

              if (hasStorage) defaultPlanData.storage_gb = 10;

              if (hasMaxUsers) defaultPlanData.max_users = 25;

              const [planId] =
                await trx("subscription_plans").insert(defaultPlanData);

              plan = await trx("subscription_plans")
                .where("id", planId)
                .first();
            }

            const startDate = new Date();

            const trialDays = plan.trial_days || 30; // Default 30 days if not set

            const trialEndDate = new Date(startDate);

            trialEndDate.setDate(trialEndDate.getDate() + trialDays);

            const subscriptionColumns = await trx(
              "company_subscriptions",
            ).columnInfo();

            const subscriptionData = {
              company_id: companyPkId,

              plan_id: plan.id,

              start_date: startDate,

              end_date: trialEndDate,

              trial_end_date: trialEndDate,

              status: "trial",

              billing_cycle: "monthly",

              next_billing_date: trialEndDate,
            };

            if (subscriptionColumns.max_users) {
              subscriptionData.max_users = 999; // Unlimited users during trial
            }

            if (subscriptionColumns.storage_gb) {
              subscriptionData.storage_gb = plan.storage_gb || 10;
            }

            await trx("company_subscriptions").insert(subscriptionData);

            console.log(
              `Free trial subscription created for company ${companyPkId} - ${trialDays} days`,
            );
          }
        } catch (subscriptionError) {
          console.error(
            "Failed to create trial subscription:",
            subscriptionError,
          );

          // Don't fail registration if subscription creation fails
        }
      }

      /* ---------------- CREATE LEAVE BALANCES FOR ADMIN ---------------- */

      if (role === "admin" && companyPkId) {
        try {
          // Get the employee record that was just created

          const adminEmployee = await trx("employees")
            .where({
              company_id: companyPkId,

              email: email.trim().toLowerCase(),
            })

            .first();

          if (adminEmployee) {
            // Get active leave types for the company

            const leaveTypes = await trx("leave_types")
              .where({
                company_id: companyPkId,

                status: "active",
              })

              .select("id", "name", "annual_limit");

            const currentYear = new Date().getFullYear();

            for (const leaveType of leaveTypes) {
              // Check if leave balance already exists

              const existingBalance = await trx("leave_balances")
                .where({
                  employee_id: adminEmployee.id,

                  company_id: companyPkId,

                  leave_type_id: leaveType.id,

                  year: currentYear,
                })

                .first();

              if (!existingBalance) {
                await trx("leave_balances").insert({
                  company_id: companyPkId,

                  employee_id: adminEmployee.id,

                  leave_type_id: leaveType.id,

                  opening_balance: leaveType.annual_limit,

                  availed: 0,

                  available: leaveType.annual_limit,

                  year: currentYear,
                });

                console.log(
                  `Created ${leaveType.name} balance for admin: ${leaveType.annual_limit} days`,
                );
              }
            }
          }
        } catch (leaveBalanceError) {
          console.error(
            "Failed to create leave balances for admin:",
            leaveBalanceError,
          );

          // Don't fail registration if leave balance creation fails
        }
      }
    });

    /* ---------------- SEND REGISTRATION MAIL (OUTSIDE TRANSACTION) ---------------- */

    sendRegistrationSuccessMail(
      createdUser,

      role === "admin" ? createdCompanyName : null,
    ).catch((err) => console.error("Registration mail failed:", err));

    /* ---------------- TOKEN ---------------- */

    const tokenUser = {
      id: createdUser.id,

      email: createdUser.email,

      role: createdUser.role,

      company_id: createdUser.company_id,
    };

    const accessToken = generateAccessToken({ ...tokenUser, type: "admin" });

    const refreshToken = generateRefreshToken({ ...tokenUser, type: "admin" });

    setAuthCookies(res, accessToken, refreshToken);

    /* ---------------- RESPONSE ---------------- */

    res.status(201).json({
      success: true,

      message: "Registered successfully!",

      note:
        role === "admin"
          ? `Company "${createdCompanyName}" created successfully`
          : null,

      user: {
        id: createdUser.id,

        name: createdUser.name,

        email: createdUser.email,

        role: createdUser.role,

        department: createdUser.department,

        company_id: createdUser.company_id,

        avatar: createdUser.avatar,
      },

      token: accessToken,

      accessToken,

      refreshToken,
    });
  } catch (error) {
    console.error("Registration error:", error);

    // Normalize DB unique-constraint errors into a user-friendly message

    if (
      error?.code === "ER_DUP_ENTRY" ||
      String(error?.message || "")
        .toLowerCase()
        .includes("duplicate entry")
    ) {
      return res.status(400).json({
        message: "Email already exists",
      });
    }

    res.status(500).json({
      message: error.message || "Server error during registration",
    });
  }
};

const login = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: "Email and password are required" });
  }

  try {
    let user = null;

    let userType = null;

    let companyId = null;

    // 1. Check users table (Admin / Super Admin)

    user = await knex("users").where({ email }).first();

    if (user) {
      userType = "admin";

      companyId = user.company_id;
    } else {
      // 2. Check employees table

      user = await knex("employees").where({ email }).first();

      if (!user) {
        return res.status(401).json({ message: "Invalid email or password" });
      }

      userType = "employee";

      companyId = user.company_id;

      if (!companyId) {
        return res
          .status(403)
          .json({ message: "Employee not assigned to any company" });
      }
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const userRoles = await getEffectiveRolesForUser(user, userType, companyId);

    // 🔥 TOKEN WITH DEPARTMENT & DESIGNATION

    const tokenUser = {
      id: user.id,

      email: user.email,

      role: user.role || "employee",

      roles: userRoles,

      type: userType,

      company_id: companyId,

      // 🔥 IMPORTANT

      department_id: user.department_id || null,

      designation_id: user.designation_id || null,
    };

    const accessToken = generateAccessToken(tokenUser);

    const refreshToken = generateRefreshToken(tokenUser);

    setAuthCookies(res, accessToken, refreshToken);

    const fullName = user.first_name
      ? `${user.first_name} ${user.last_name || ""}`.trim()
      : user.name || "User";

    res.json({
      success: true,

      message: "Login successful",

      token: accessToken,

      accessToken,

      refreshToken,

      user: {
        id: user.id,

        name: fullName,

        email: user.email,

        role: user.role || "employee",

        roles: userRoles,

        // 🔥 PROPER FIELDS

        department_id: user.department_id || null,

        designation_id: user.designation_id || null,

        company_id: companyId,

        avatar:
          user.avatar ||
          `https://api.dicebear.com/7.x/avataaars/svg?seed=${email}`,

        type: userType,
      },
    });
  } catch (error) {
    console.error("Login error:", error);

    res.status(500).json({ message: "Server error during login" });
  }
};

const refreshAccessToken = async (req, res) => {
  const cookies = parseCookies(req.headers.cookie);

  const refreshToken = req.body?.refreshToken || cookies.refreshToken;

  if (!refreshToken) {
    return res.status(400).json({ message: "Refresh token is required" });
  }

  try {
    let decoded;

    const refreshSecret = process.env.JWT_REFRESH_SECRET;

    const accessSecret = process.env.JWT_SECRET;

    try {
      decoded = jwt.verify(refreshToken, refreshSecret || accessSecret);
    } catch (error) {
      const isInvalidSignature =
        error?.name === "JsonWebTokenError" &&
        String(error?.message || "")
          .toLowerCase()
          .includes("invalid signature");

      if (
        isInvalidSignature &&
        refreshSecret &&
        accessSecret &&
        refreshSecret !== accessSecret
      ) {
        // Fallback: accept tokens signed with JWT_SECRET if env mismatched previously

        decoded = jwt.verify(refreshToken, accessSecret);
      } else {
        throw error;
      }
    }

    if (decoded.tokenType && decoded.tokenType !== "refresh") {
      return res.status(401).json({ message: "Invalid token type" });
    }

    let user = null;

    let userType = decoded.type;

    let companyId = null;

    if (userType === "admin") {
      user = await knex("users").where({ id: decoded.id }).first();

      if (!user) {
        return res.status(401).json({ message: "Admin user not found" });
      }

      companyId = user.company_id;
    } else if (userType === "employee") {
      user = await knex("employees").where({ id: decoded.id }).first();

      if (!user) {
        return res.status(401).json({ message: "Employee not found" });
      }

      if (!user.company_id) {
        return res
          .status(403)
          .json({ message: "Employee not assigned to any company" });
      }

      companyId = user.company_id;
    } else {
      return res.status(401).json({ message: "Invalid user type" });
    }

    const userRoles = await getEffectiveRolesForUser(user, userType, companyId);

    const tokenUser = {
      id: user.id,

      email: user.email,

      role: user.role || "employee",

      roles: userRoles,

      type: userType,

      company_id: companyId,

      department_id: user.department_id || null,

      designation_id: user.designation_id || null,
    };

    const accessToken = generateAccessToken(tokenUser);

    const nextRefreshToken = generateRefreshToken(tokenUser);

    setAuthCookies(res, accessToken, nextRefreshToken);

    res.json({
      success: true,

      token: accessToken,

      accessToken,

      refreshToken: nextRefreshToken,
    });
  } catch (error) {
    console.error("Refresh token error:", error.message);

    if (error.name === "TokenExpiredError") {
      return res.status(401).json({ message: "Refresh token expired" });
    }

    return res.status(401).json({ message: "Invalid refresh token" });
  }
};

const changePassword = async (req, res) => {
  if (!req.user || !req.user.id) {
    return res.status(401).json({ message: "Not authorized" });
  }

  const userId = req.user.id;

  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res
      .status(400)
      .json({ message: "Current and new password are required" });
  }

  if (newPassword.length < 6) {
    return res
      .status(400)
      .json({ message: "New password must be at least 6 characters" });
  }

  try {
    let user;

    // Check if admin (users table)

    if (req.user.type === "admin") {
      user = await knex("users").where({ id: userId }).first();
    } else {
      // Employee

      user = await knex("employees").where({ id: userId }).first();
    }

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Verify current password

    const isMatch = await bcrypt.compare(currentPassword, user.password);

    if (!isMatch) {
      return res.status(400).json({ message: "Current password is incorrect" });
    }

    // Hash new password

    const salt = await bcrypt.genSalt(10);

    const hashedPassword = await bcrypt.hash(newPassword, salt);

    // Update password in correct table

    if (req.user.type === "admin") {
      await knex("users")
        .where({ id: userId })
        .update({ password: hashedPassword });
    } else {
      // Employee

      await knex("employees").where({ id: userId }).update({
        password: hashedPassword,
      });
    }

    res.json({
      success: true,

      message: "Password changed successfully",
    });
  } catch (error) {
    console.error("Change password error:", error);

    res.status(500).json({ message: "Server error" });
  }
};

// Logout - Stateless JWT, so just client-side

const logout = async (req, res) => {
  clearAuthCookies(res);

  res.json({
    success: true,

    message: "Logged out successfully.",
  });
};

// Generate 6-digit OTP

const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

const getPasswordResetUser = async (email) => {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) return null;

  const adminUser = await knex("users").where({ email: normalizedEmail }).first();
  if (adminUser) {
    return { user: adminUser, tableName: "users", email: normalizedEmail };
  }

  const employee = await knex("employees").where({ email: normalizedEmail }).first();
  if (employee) {
    return { user: employee, tableName: "employees", email: normalizedEmail };
  }

  return null;
};

const getMailerFromAddress = () =>
  process.env.EMAIL_FROM ||
  process.env.EMAIL_USER ||
  process.env.SMTP_USER ||
  "no-reply@hrms.procease.co";

// Check if email exists and send OTP

const initiateForgotPassword = async (req, res) => {
  try {
    const normalizedEmail = String(req.body?.email || "").trim().toLowerCase();

    if (!normalizedEmail) {
      return res.status(400).json({ message: "Email is required" });
    }

    const resetUser = await getPasswordResetUser(normalizedEmail);
    if (!resetUser) {
      return res.status(404).json({ message: "Email not found in system" });
    }

    // Generate OTP

    const otp = generateOTP();

    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
    await knex(resetUser.tableName).where({ id: resetUser.user.id }).update({
      reset_otp: otp,
      otp_expiry: otpExpiry,
      otp_verified: false,
    });

    // Send OTP via email (using nodemailer)

    const mailOptions = {
      from: `"HRMS Support" <${getMailerFromAddress()}>`,

      to: normalizedEmail,

      subject: "Password Reset OTP",

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

      `,
    };

    try {
      await transporter.sendMail(mailOptions);
    } catch (mailError) {
      console.error("Forgot password OTP mail error:", {
        code: mailError?.code,
        command: mailError?.command,
        response: mailError?.response,
        message: mailError?.message,
      });
      throw mailError;
    }

    res.json({
      success: true,

      message: "OTP sent successfully to your email",
    });
  } catch (error) {
    console.error("Forgot password initiation error:", {
      code: error?.code,
      errno: error?.errno,
      sqlMessage: error?.sqlMessage,
      message: error?.message,
    });

    res.status(500).json({ message: "Failed to send OTP. Please try again." });
  }
};

// Verify OTP

const verifyOTP = async (req, res) => {
  try {
    const { otp } = req.body;
    const normalizedEmail = String(req.body?.email || "").trim().toLowerCase();

    if (!normalizedEmail || !otp) {
      return res.status(400).json({ message: "Email and OTP are required" });
    }

    const resetUser = await getPasswordResetUser(normalizedEmail);
    if (!resetUser) {
      return res.status(404).json({ message: "User not found" });
    }

    const { user, tableName } = resetUser;

    // Check if OTP exists and is valid

    if (!user.reset_otp || user.reset_otp !== otp) {
      return res.status(400).json({ message: "Invalid OTP" });
    }

    // Check if OTP has expired

    if (new Date() > new Date(user.otp_expiry)) {
      return res
        .status(400)
        .json({ message: "OTP has expired. Please request a new one." });
    }

    await knex(tableName).where({ id: user.id }).update({
      otp_verified: true,
    });

    res.json({
      success: true,

      message: "OTP verified successfully",

      userId: user.id,
    });
  } catch (error) {
    console.error("OTP verification error:", {
      code: error?.code,
      errno: error?.errno,
      sqlMessage: error?.sqlMessage,
      message: error?.message,
    });

    res.status(500).json({ message: "Failed to verify OTP" });
  }
};

// Reset password with verified OTP

const resetPassword = async (req, res) => {
  try {
    const { newPassword, confirmPassword } = req.body;
    const normalizedEmail = String(req.body?.email || "").trim().toLowerCase();

    if (!normalizedEmail || !newPassword || !confirmPassword) {
      return res.status(400).json({ message: "All fields are required" });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({ message: "Passwords do not match" });
    }

    if (newPassword.length < 6) {
      return res
        .status(400)
        .json({ message: "Password must be at least 6 characters" });
    }

    const resetUser = await getPasswordResetUser(normalizedEmail);
    if (!resetUser) {
      return res.status(404).json({ message: "User not found" });
    }

    const { user, tableName } = resetUser;

    // Verify OTP was verified

    if (!user.otp_verified) {
      return res.status(400).json({ message: "Please verify OTP first" });
    }

    // Hash new password

    const salt = await bcrypt.genSalt(10);

    const hashedPassword = await bcrypt.hash(newPassword, salt);

    await knex(tableName).where({ id: user.id }).update({
      password: hashedPassword,
      reset_otp: null,
      otp_expiry: null,
      otp_verified: false,
    });

    res.json({
      success: true,

      message:
        "Password reset successfully. Please login with your new password.",
    });
  } catch (error) {
    console.error("Reset password error:", {
      code: error?.code,
      errno: error?.errno,
      sqlMessage: error?.sqlMessage,
      message: error?.message,
    });

    res.status(500).json({ message: "Failed to reset password" });
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

  resetPassword,
};
