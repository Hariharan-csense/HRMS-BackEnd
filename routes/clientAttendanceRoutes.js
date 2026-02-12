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

// Apply auth middleware to all routes
router.use(protect);

// GET /api/client-attendance/today - Get today's client attendance
router.get('/today', getTodayClientAttendance);

// GET /api/client-attendance/active - Get current active check-in
router.get('/active', getActiveCheckIn);

// GET /api/client-attendance/all - Get all client attendance (Admin)
router.get('/all', getAllClientAttendance);

// POST /api/client-attendance/checkin - Check in to client
router.post('/checkin', checkInToClient);

// POST /api/client-attendance/checkout/:id - Check out from client
router.post('/checkout/:id', checkOutFromClient);

// GET /api/client-attendance/history - Get attendance history
router.get('/history', getClientAttendanceHistory);

module.exports = router;
