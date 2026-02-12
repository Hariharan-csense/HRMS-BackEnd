const express = require('express');
const router = express.Router();
const {
  getOnboardingEmployees,
  getOnboardingEmployeeById,
  createOnboardingEmployee,
  updateOnboardingEmployee,
  deleteOnboardingEmployee,
  createOnboardingTask,
  toggleTaskCompletion,
  createOnboardingDocument,
  updateDocumentUpload,
  getOnboardingStats
} = require('../controllers/onboardingController');
const { protect} = require('../middleware/authMiddleware');

// Apply authentication middleware to all routes
router.use(protect);

// Onboarding Employees routes
router.get('/', getOnboardingEmployees);
router.get('/stats', getOnboardingStats);
router.get('/:id', getOnboardingEmployeeById);
router.post('/', createOnboardingEmployee);
router.put('/:id', updateOnboardingEmployee);
router.delete('/:id', deleteOnboardingEmployee);

// Tasks routes
router.post('/:id/tasks', createOnboardingTask);
router.patch('/tasks/:taskId/toggle', toggleTaskCompletion);

// Documents routes
router.post('/:id/documents', createOnboardingDocument);
router.patch('/documents/:documentId/upload', updateDocumentUpload);

module.exports = router;
