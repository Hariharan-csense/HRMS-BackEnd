// src/routes/leavePermissionRoutes.js
const express = require('express');
const {
  applyLeavePermission,
  getLeavePermissionApplications,
  updateLeavePermissionStatus,
  getLeavePermissionRelevantUsers
} = require('../controllers/leavePermissionController');
const { protect } = require('../middleware/authMiddleware');
const { requirePermission, requireAnyPermission } = require("../middleware/rbacMiddleware");

const router = express.Router();

// Apply leave permission (employee)
router.post('/apply', protect, requirePermission("leave", "create", { submodule: "permission" }), applyLeavePermission);

// Get applications (role-based)
router.get('/applications', protect, requirePermission("leave", "view", { submodule: "permission" }), getLeavePermissionApplications);

// Approve/reject (HR/Admin only)
router.put(
  '/:id/status',
  protect,
  requireAnyPermission([
    { module: "leave", submodule: "permission", action: "approve" },
    { module: "leave", submodule: "permission", action: "reject" },
  ]),
  updateLeavePermissionStatus
);

// Get relevant users for notifications
router.get('/relevant-users', protect, requirePermission("leave", "view", { submodule: "permission" }), getLeavePermissionRelevantUsers);

module.exports = router;
