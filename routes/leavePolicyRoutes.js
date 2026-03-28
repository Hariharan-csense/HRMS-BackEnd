const express = require('express');
const router = express.Router();
//const leavePolicyController = require('../controllers/leavePolicyController');
const { protect } = require('../middleware/authMiddleware');
const { requirePermission } = require("../middleware/rbacMiddleware");
const {
  getAllLeavePolicies,
  getLeavePolicyById,
  createLeavePolicy,
  updateLeavePolicy,
  deleteLeavePolicy
} = require('../controllers/leavePolicyController');

router.get('/', protect, requirePermission("leave", "view", { submodule: "config" }), getAllLeavePolicies);
router.get('/:id', protect, requirePermission("leave", "view", { submodule: "config" }), getLeavePolicyById);
router.post('/', protect, requirePermission("leave", "create", { submodule: "config" }), createLeavePolicy);
router.put('/:id', protect, requirePermission("leave", "update", { submodule: "config" }), updateLeavePolicy);
router.delete('/:id', protect, requirePermission("leave", "delete", { submodule: "config" }), deleteLeavePolicy);


module.exports = router;
