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

// Apply authentication middleware to all routes
router.use(protect);

// Job Requirements routes
router.get('/', getJobRequirements);
router.get('/stats', getJobRequirementsStats);
router.get('/:id', getJobRequirementById);
router.post('/', createJobRequirement);
router.put('/:id', updateJobRequirement);
router.patch('/:id/filled-positions', updateFilledPositions);
router.delete('/:id', deleteJobRequirement);

module.exports = router;
