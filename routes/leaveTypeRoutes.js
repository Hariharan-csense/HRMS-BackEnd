const express = require('express');
const router = express.Router();
const { protect, adminOnly } = require('../middleware/authMiddleware');
const leaveTypeController = require('../controllers/leaveTypeController');
//const updateLeaveTypeById = require('../controllers/leaveTypeController')

router.post(
  '/leave-types',
  protect,
  adminOnly,
  leaveTypeController.createLeaveType
);
router.put(
  '/leave-types/:id',
  protect,
  adminOnly,
  leaveTypeController.updateLeaveTypeById
);

router.delete(
  '/leave-types/:id',
  protect,
  adminOnly,
  leaveTypeController.deleteLeaveTypeById
);

module.exports = router;
