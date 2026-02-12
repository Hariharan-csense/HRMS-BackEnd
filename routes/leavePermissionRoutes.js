// src/routes/leavePermissionRoutes.js
const express = require('express');
const {
  applyLeavePermission,
  getLeavePermissionApplications,
  updateLeavePermissionStatus,
  getLeavePermissionRelevantUsers
} = require('../controllers/leavePermissionController');
const { protect, adminOnly } = require('../middleware/authMiddleware');

const router = express.Router();

// Apply leave permission (employee)
router.post('/apply', protect, applyLeavePermission);

// Get applications (role-based)
router.get('/applications', protect, getLeavePermissionApplications);

// Approve/reject (HR/Admin only)
router.put('/:id/status', protect, updateLeavePermissionStatus);

// Get relevant users for notifications
router.get('/relevant-users', protect, getLeavePermissionRelevantUsers);

module.exports = router;
