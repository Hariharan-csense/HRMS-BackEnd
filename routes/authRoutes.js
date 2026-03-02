// src/routes/authRoutes.js
const express = require('express');
const { registerUser, login, logout, refreshAccessToken, changePassword, initiateForgotPassword, verifyOTP, resetPassword } = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware');
const { requirePermission } = require("../middleware/rbacMiddleware");
const router = express.Router();

// POST /api/auth/register  → Only admin can register new users
router.post('/register', registerUser);
router.post('/login', login);
router.post('/refresh-token', refreshAccessToken);
router.post('/reset-password', protect, requirePermission("employees", "update", { submodule: "profile" }), changePassword);
router.post('/logout',logout);

// Forgot Password Routes
router.post('/forgot-password', initiateForgotPassword);
router.post('/verify-otp', verifyOTP);
router.post('/reset-password-forgot', resetPassword);

module.exports = router;
