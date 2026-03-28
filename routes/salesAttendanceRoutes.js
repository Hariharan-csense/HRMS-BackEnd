const express = require('express');
const router = express.Router();
const {
  getSalesAttendanceComparison,
  getSalesEmployeeDetail
} = require('../controllers/salesAttendanceController');
const { protect } = require('../middleware/authMiddleware');
const { requirePermission } = require("../middleware/rbacMiddleware");

// Apply auth middleware to all routes
router.use(protect, requirePermission("my_analytics", "view"));

// GET /api/sales-attendance/comparison - Get sales department attendance comparison
router.get('/comparison', getSalesAttendanceComparison);

// GET /api/sales-attendance/employee/:id - Get detailed attendance for specific sales employee
router.get('/employee/:id', getSalesEmployeeDetail);

module.exports = router;
