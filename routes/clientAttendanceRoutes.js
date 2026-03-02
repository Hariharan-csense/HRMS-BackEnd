const express = require('express');
const router = express.Router();
const {
  getTodayClientAttendance,
  checkInToClient,
  checkOutFromClient,
  getClientAttendanceHistory,
  getActiveCheckIn,
  getAllClientAttendance
} = require('../controllers/clientAttendanceController');
const { protect } = require('../middleware/authMiddleware');
const { requirePermission } = require("../middleware/rbacMiddleware");

// Apply auth middleware to all routes
router.use(protect);

// GET /api/client-attendance/today - Get today's client attendance
router.get('/today', requirePermission("client_attendance", "view"), getTodayClientAttendance);

// GET /api/client-attendance/active - Get current active check-in
router.get('/active', requirePermission("client_attendance", "view"), getActiveCheckIn);

// GET /api/client-attendance/all - Get all client attendance (Admin)
router.get('/all', requirePermission("client_attendance_admin", "view"), getAllClientAttendance);

// POST /api/client-attendance/checkin - Check in to client
router.post('/checkin', requirePermission("client_attendance", "create"), checkInToClient);

// POST /api/client-attendance/checkout/:id - Check out from client
router.post('/checkout/:id', requirePermission("client_attendance", "update"), checkOutFromClient);

// GET /api/client-attendance/history - Get attendance history
router.get('/history', requirePermission("client_attendance", "view"), getClientAttendanceHistory);

module.exports = router;
