const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const leaveTypeController = require('../controllers/leaveTypeController');
const { requirePermission } = require("../middleware/rbacMiddleware");
//const updateLeaveTypeById = require('../controllers/leaveTypeController')

router.post(
  '/leave-types',
  protect,
  requirePermission("leave", "create", { submodule: "config" }),
  leaveTypeController.createLeaveType
);
router.put(
  '/leave-types/:id',
  protect,
  requirePermission("leave", "update", { submodule: "config" }),
  leaveTypeController.updateLeaveTypeById
);

router.delete(
  '/leave-types/:id',
  protect,
  requirePermission("leave", "delete", { submodule: "config" }),
  leaveTypeController.deleteLeaveTypeById
);

module.exports = router;
