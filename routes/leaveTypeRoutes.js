const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const leaveTypeController = require('../controllers/leaveTypeController');
const { requireAnyPermission } = require("../middleware/rbacMiddleware");
//const updateLeaveTypeById = require('../controllers/leaveTypeController')

router.post(
  '/leave-types',
  protect,
  requireAnyPermission([
    { module: "leave", submodule: "leave_types", action: "create" },
    { module: "leave", submodule: "config", action: "create" },
    { module: "leave", submodule: "configuration", action: "create" },
  ]),
  leaveTypeController.createLeaveType
);
router.put(
  '/leave-types/:id',
  protect,
  requireAnyPermission([
    { module: "leave", submodule: "leave_types", action: "update" },
    { module: "leave", submodule: "config", action: "update" },
    { module: "leave", submodule: "configuration", action: "update" },
  ]),
  leaveTypeController.updateLeaveTypeById
);

router.delete(
  '/leave-types/:id',
  protect,
  requireAnyPermission([
    { module: "leave", submodule: "leave_types", action: "delete" },
    { module: "leave", submodule: "config", action: "delete" },
    { module: "leave", submodule: "configuration", action: "delete" },
  ]),
  leaveTypeController.deleteLeaveTypeById
);

module.exports = router;
