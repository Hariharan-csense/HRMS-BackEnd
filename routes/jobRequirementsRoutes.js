const express = require('express');
const router = express.Router();
const {
  getJobRequirements,
  getJobRequirementById,
  createJobRequirement,
  updateJobRequirement,
  deleteJobRequirement,
  updateFilledPositions,
  getJobRequirementsStats
} = require('../controllers/jobRequirementsController');
const { protect } = require('../middleware/authMiddleware');
const { requirePermission } = require("../middleware/rbacMiddleware");

// Apply authentication middleware to all routes
router.use(protect);

// Job Requirements routes
router.get('/', requirePermission("hr_management", "view", { submodule: "requirements" }), getJobRequirements);
router.get('/stats', requirePermission("hr_management", "view", { submodule: "requirements" }), getJobRequirementsStats);
router.get('/:id', requirePermission("hr_management", "view", { submodule: "requirements" }), getJobRequirementById);
router.post('/', requirePermission("hr_management", "create", { submodule: "requirements" }), createJobRequirement);
router.put('/:id', requirePermission("hr_management", "update", { submodule: "requirements" }), updateJobRequirement);
router.patch('/:id/filled-positions', requirePermission("hr_management", "update", { submodule: "requirements" }), updateFilledPositions);
router.delete('/:id', requirePermission("hr_management", "delete", { submodule: "requirements" }), deleteJobRequirement);

module.exports = router;
