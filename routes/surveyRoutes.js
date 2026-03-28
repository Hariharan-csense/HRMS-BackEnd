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
const { protect } = require('../middleware/authMiddleware');
const { requirePermission } = require("../middleware/rbacMiddleware");

// Admin routes
router.post('/', protect, requirePermission("pulse_surveys", "create", { submodule: "create" }), createSurvey);
router.get('/admin', protect, requirePermission("pulse_surveys", "view", { submodule: "dashboard" }), getSurveys);
router.get('/admin/:id', protect, requirePermission("pulse_surveys", "view", { submodule: "results" }), getSurveyById);
router.get('/admin/:id/responses', protect, requirePermission("pulse_surveys", "view", { submodule: "results" }), getSurveyResponses);
router.put('/admin/:id/status', protect, requirePermission("pulse_surveys", "update", { submodule: "results" }), updateSurveyStatus);
router.delete('/admin/:id', protect, requirePermission("pulse_surveys", "delete", { submodule: "results" }), deleteSurvey);

// Feedback routes
router.get('/feedback', protect, requirePermission("pulse_surveys", "view", { submodule: "feedback_inbox" }), getFeedback);
router.put('/feedback/:id/status', protect, requirePermission("pulse_surveys", "update", { submodule: "feedback_inbox" }), updateFeedbackStatus);
router.delete('/feedback/:id', protect, requirePermission("pulse_surveys", "delete", { submodule: "feedback_inbox" }), deleteFeedback);

// Employee routes
router.get('/active', protect, requirePermission("pulse_surveys", "view", { submodule: "my_surveys" }), getActiveSurveys);
router.get('/:id', protect, requirePermission("pulse_surveys", "view", { submodule: "my_surveys" }), getSurveyById);
router.post('/:id/respond', protect, requirePermission("pulse_surveys", "create", { submodule: "respond" }), submitSurveyResponse);
router.put('/:id/respond', protect, requirePermission("pulse_surveys", "update", { submodule: "respond" }), updateSurveyResponse);
router.post('/feedback', protect, requirePermission("pulse_surveys", "create", { submodule: "feedback" }), submitFeedback);

module.exports = router;
