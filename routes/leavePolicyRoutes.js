const express = require('express');
const router = express.Router();
//const leavePolicyController = require('../controllers/leavePolicyController');
const { protect, adminOnly } = require('../middleware/authMiddleware');
const {
  getAllLeavePolicies,
  getLeavePolicyById,
  createLeavePolicy,
  updateLeavePolicy,
  deleteLeavePolicy
} = require('../controllers/leavePolicyController');

router.get('/', protect, adminOnly, getAllLeavePolicies);
router.get('/:id', protect, adminOnly, getLeavePolicyById);
router.post('/', protect, adminOnly, createLeavePolicy);
router.put('/:id', protect, adminOnly, updateLeavePolicy);
router.delete('/:id', protect, adminOnly, deleteLeavePolicy);


module.exports = router;