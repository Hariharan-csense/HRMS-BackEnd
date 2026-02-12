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

// Apply authentication middleware to all routes
router.use(protect);

// Candidates routes
router.get('/candidates', getCandidates);
router.get('/candidates/stats', getRecruitmentStats);
router.get('/candidates/:id', getCandidateById);
router.post('/candidates', createCandidate);
router.put('/candidates/:id', updateCandidate);
router.patch('/candidates/:id/status', updateCandidateStatus);
router.delete('/candidates/:id', deleteCandidate);

// Interview routes
router.post('/:id/interviews', createInterview);
router.put('/interviews/:interviewId', updateInterview);

module.exports = router;
