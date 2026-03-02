const express = require('express');
const { getAllChecklists, updateChecklistItem, updateEmployeeStatusForCompletedChecklist } = require('../controllers/checklistController');
const { protect } = require('../middleware/authMiddleware');
const { requirePermission } = require("../middleware/rbacMiddleware");

const router = express.Router();

// All routes must go through protect middleware
router.get('/', protect, requirePermission("exit", "view", { submodule: "checklist" }), getAllChecklists);
router.put('/:id', protect, requirePermission("exit", "update", { submodule: "checklist" }), updateChecklistItem);
router.post('/:id/update-employee-status', protect, requirePermission("exit", "update", { submodule: "checklist" }), updateEmployeeStatusForCompletedChecklist);

module.exports = router;
