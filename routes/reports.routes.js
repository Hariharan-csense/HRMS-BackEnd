// routes/reports.routes.js  (Create this file if it doesn't exist)

const express = require('express');
const router = express.Router();

const {
  getReportFilters,
  getAttendanceReport,
  getLeaveReport,
  getPayrollReport,
  getExpenseReport,
} = require('../controllers/reports.controller');

const { protect } = require('../middleware/authMiddleware');
const { requirePermission, requireAnyPermission } = require("../middleware/rbacMiddleware");

// Apply auth to all reports routes


router.get('/filters', protect, requireAnyPermission([
  { module: "reports", action: "view", submodule: "attendance" },
  { module: "reports", action: "view", submodule: "payroll" },
  { module: "reports", action: "view", submodule: "finance" },
  { module: "reports", action: "view", submodule: "leave" },
]), getReportFilters);
router.get('/attendance', protect, requirePermission("reports", "view", { submodule: "attendance" }), getAttendanceReport);
router.get('/payroll', protect, requirePermission("reports", "view", { submodule: "payroll" }), getPayrollReport);
router.get('/expenses', protect, requirePermission("reports", "view", { submodule: "finance" }), getExpenseReport);
router.get('/leaves', protect, requirePermission("reports", "view", { submodule: "leave" }), getLeaveReport);
// admin only

//router.get('/sensitive', protect, restrictTo('admin', 'hr'), handler); // flexible

// Optional: add more specific routes if needed
// router.get('/payroll/month', getPayrollByMonth);

module.exports = router; // ← MUST export the router object
