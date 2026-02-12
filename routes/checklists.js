const express = require('express');
const { getAllChecklists, updateChecklistItem, updateEmployeeStatusForCompletedChecklist } = require('../controllers/checklistController');
const { protect, adminOnly } = require('../middleware/authMiddleware'); // ✅ make sure correct path

const router = express.Router();

// All routes must go through protect middleware
router.get('/', protect, getAllChecklists);
router.put('/:id', protect, updateChecklistItem);
router.post('/:id/update-employee-status', protect, updateEmployeeStatusForCompletedChecklist);

module.exports = router;
