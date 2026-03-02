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
const { protect } = require('../middleware/authMiddleware');
const { requirePermission, requireAnyPermission } = require("../middleware/rbacMiddleware");

const router = express.Router();

// Apply leave (employee)
router.post('/apply', protect, requirePermission("leave", "create", { submodule: "apply" }), applyLeave);

// Get applications (role-based)
router.get('/applications', protect, requirePermission("leave", "view"), getLeaveApplications);

// Approve/reject (HR/Admin only)
router.put(
  '/:id/status',
  protect,
  requireAnyPermission([
    { module: "leave", submodule: "approvals", action: "approve" },
    { module: "leave", submodule: "approvals", action: "reject" },
  ]),
  updateLeaveStatus
);

// Get leave types
router.get('/types', protect, requirePermission("leave", "view", { submodule: "config" }), getLeaveTypes);

// Get my leave balance
router.get('/balance', protect, requirePermission("leave", "view", { submodule: "balance" }), getLeaveBalance);

router.get('/relevant-users', protect, requirePermission("leave", "view"), getRelevantUsers);
 

module.exports = router;
