// src/routes/leaveRoutes.js
const express = require('express');
const {
  applyLeave,
  getLeaveApplications,
  updateLeaveStatus,
  getLeaveTypes,
  getLeaveBalance,
  getRelevantUsers
} = require('../controllers/leaveController');
const { protect, adminOnly } = require('../middleware/authMiddleware');

const router = express.Router();

// Apply leave (employee)
router.post('/apply', protect, applyLeave);

// Get applications (role-based)
router.get('/applications', protect, getLeaveApplications);

// Approve/reject (HR/Admin only)
router.put('/:id/status', protect, updateLeaveStatus);

// Get leave types
router.get('/types', protect, getLeaveTypes);

// Get my leave balance
router.get('/balance', protect, getLeaveBalance);

router.get('/relevant-users', protect, getRelevantUsers);
 

module.exports = router;