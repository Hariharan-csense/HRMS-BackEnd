// routes/reports.routes.js  (Create this file if it doesn't exist)

const express = require('express');
const router = express.Router();

const {
  getAttendanceReport,
  getLeaveReport,
  getPayrollReport,
  getExpenseReport,
} = require('../controllers/reports.controller');

const { adminOnly, financeOnly, protect, restrictTo } = require('../middleware/authMiddleware'); // adjust path if needed

// Apply auth to all reports routes


router.get('/attendance', protect, getAttendanceReport); // any authenticated user

router.get('/payroll', protect, financeOnly, getPayrollReport); // finance or admin

router.get('/expenses', protect, adminOnly, getExpenseReport);

router.get('/leaves', protect, restrictTo('admin', 'hr', 'manager'), getLeaveReport);
// admin only

//router.get('/sensitive', protect, restrictTo('admin', 'hr'), handler); // flexible

// Optional: add more specific routes if needed
// router.get('/payroll/month', getPayrollByMonth);

module.exports = router; // ← MUST export the router object