const express = require('express');
const router = express.Router();
const { 
  getAttendanceStatus,
  checkIn, 
  checkOut, 
  getAttendanceLogs, 
  getAttendanceByEmployeeAndMonth,
  createOverride, 
  processOverride, 
  getEmployeeSummary,
  getOverrides
} = require('../controllers/attendanceController');
const { protect } = require('../middleware/authMiddleware');
const uploadAttendanceImage = require('../middleware/attendanceUpload');
const { requirePermission } = require('../middleware/rbacMiddleware');

// Check current attendance status
router.get('/status', protect, requirePermission("attendance", "view"), getAttendanceStatus);

// Check-in/Check-out routes with file upload
router.post('/check-in', protect, requirePermission("attendance", "create", { submodule: "capture" }), uploadAttendanceImage('image'), checkIn);
router.post('/check-out', protect, requirePermission("attendance", "create", { submodule: "capture" }), uploadAttendanceImage('image'), checkOut);

// Get attendance logs with filters
router.get('/logs', protect, requirePermission("attendance", "view", { submodule: "log" }), getAttendanceLogs);

// Attendance overrides
router.post('/overrides', protect, requirePermission("attendance", "create", { submodule: "override" }), createOverride);
router.put('/overrides/:overrideId/process', protect, requirePermission("attendance", "update", { submodule: "override" }), processOverride);

// Reports
router.get('/summary/employee/:employeeId', protect, requirePermission("attendance", "view"), getEmployeeSummary);
router.get('/overrides', protect, requirePermission("attendance", "view", { submodule: "override" }), getOverrides);

// Payroll helper: employee monthly attendance (employee code or id)
router.get('/:employeeId/:month', protect, requirePermission("attendance", "view"), getAttendanceByEmployeeAndMonth);

module.exports = router;
