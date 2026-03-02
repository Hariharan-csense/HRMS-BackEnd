// routes/reports.routes.js  (Create this file if it doesn't exist)

const express = require('express');
const router = express.Router();

const {
  getAttendanceReport,
  getLeaveReport,
  getPayrollReport,
  getExpenseReport,
} = require('../controllers/reports.controller');

const { protect } = require('../middleware/authMiddleware');
const { requirePermission } = require("../middleware/rbacMiddleware");

// Apply auth to all reports routes


router.get('/attendance', protect, requirePermission("reports", "view", { submodule: "attendance" }), getAttendanceReport);
router.get('/payroll', protect, requirePermission("reports", "view", { submodule: "payroll" }), getPayrollReport);
router.get('/expenses', protect, requirePermission("reports", "view", { submodule: "finance" }), getExpenseReport);
router.get('/leaves', protect, requirePermission("reports", "view", { submodule: "leave" }), getLeaveReport);
// admin only

//router.get('/sensitive', protect, restrictTo('admin', 'hr'), handler); // flexible

// Optional: add more specific routes if needed
// router.get('/payroll/month', getPayrollByMonth);

module.exports = router; // ← MUST export the router object
