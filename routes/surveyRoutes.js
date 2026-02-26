const express = require('express');
const router = express.Router();
const {
  createSurvey,
  getSurveys,
  getActiveSurveys,
  getSurveyById,
  submitSurveyResponse,
  updateSurveyResponse,
  getSurveyResponses,
  updateSurveyStatus,
  deleteSurvey,
  submitFeedback,
  getFeedback,
  updateFeedbackStatus,
  deleteFeedback
} = require('../controllers/surveyController');
const { protect, adminOnly } = require('../middleware/authMiddleware');

// Admin routes
router.post('/', protect, createSurvey);
router.get('/admin', protect, getSurveys);
router.get('/admin/:id', protect, getSurveyById);
router.get('/admin/:id/responses', protect, getSurveyResponses);
router.put('/admin/:id/status', protect, updateSurveyStatus);
router.delete('/admin/:id', protect, deleteSurvey);

// Feedback routes
router.get('/feedback', protect, adminOnly, getFeedback);
router.put('/feedback/:id/status', protect, adminOnly, updateFeedbackStatus);
router.delete('/feedback/:id', protect, adminOnly, deleteFeedback);

// Employee routes
router.get('/active', protect, getActiveSurveys);
router.get('/:id', protect, getSurveyById);
router.post('/:id/respond', protect, submitSurveyResponse);
router.put('/:id/respond', protect, updateSurveyResponse);
router.post('/feedback', protect, submitFeedback);

module.exports = router;
