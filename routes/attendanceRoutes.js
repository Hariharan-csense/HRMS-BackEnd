const express = require('express');
const router = express.Router();
const { 
  checkIn, 
  checkOut, 
  getAttendanceLogs, 
  createOverride, 
  processOverride, 
  getEmployeeSummary,
  getOverrides
} = require('../controllers/attendanceController');
const { protect } = require('../middleware/authMiddleware');
const uploadAttendanceImage = require('../middleware/attendanceUpload');

// Check-in/Check-out routes with file upload
router.post('/check-in', protect, uploadAttendanceImage('image'), checkIn);
router.post('/check-out', protect, uploadAttendanceImage('image'), checkOut);

// Get attendance logs with filters
router.get('/logs', protect, getAttendanceLogs);

// Attendance overrides
router.post('/overrides', protect, createOverride);
router.put('/overrides/:overrideId/process', protect, processOverride);

// Reports
router.get('/summary/employee/:employeeId', protect, getEmployeeSummary);
router.get('/overrides', protect, getOverrides);

module.exports = router;
