const express = require('express');
const router = express.Router();
const {
  getCandidates,
  getCandidateById,
  createCandidate,
  updateCandidate,
  updateCandidateStatus,
  deleteCandidate,
  createInterview,
  updateInterview,
  getRecruitmentStats
} = require('../controllers/recruitmentController');
const { protect } = require('../middleware/authMiddleware');
const { requirePermission } = require("../middleware/rbacMiddleware");

// Apply authentication middleware to all routes
router.use(protect);

// Candidates routes
router.get('/candidates', requirePermission("hr_management", "view", { submodule: "recruitment" }), getCandidates);
router.get('/candidates/stats', requirePermission("hr_management", "view", { submodule: "recruitment" }), getRecruitmentStats);
router.get('/candidates/:id', requirePermission("hr_management", "view", { submodule: "recruitment" }), getCandidateById);
router.post('/candidates', requirePermission("hr_management", "create", { submodule: "recruitment" }), createCandidate);
router.put('/candidates/:id', requirePermission("hr_management", "update", { submodule: "recruitment" }), updateCandidate);
router.patch('/candidates/:id/status', requirePermission("hr_management", "update", { submodule: "recruitment" }), updateCandidateStatus);
router.delete('/candidates/:id', requirePermission("hr_management", "delete", { submodule: "recruitment" }), deleteCandidate);

// Interview routes
router.post('/:id/interviews', requirePermission("hr_management", "create", { submodule: "recruitment" }), createInterview);
router.put('/interviews/:interviewId', requirePermission("hr_management", "update", { submodule: "recruitment" }), updateInterview);

module.exports = router;
