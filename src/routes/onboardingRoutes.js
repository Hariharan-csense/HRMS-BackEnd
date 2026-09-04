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
const { requirePermission } = require("../middleware/rbacMiddleware");

// Apply authentication middleware to all routes
router.use(protect);

// Onboarding Employees routes
router.get('/', requirePermission("hr_management", "view", { submodule: "onboarding" }), getOnboardingEmployees);
router.get('/stats', requirePermission("hr_management", "view", { submodule: "onboarding" }), getOnboardingStats);
router.get('/:id', requirePermission("hr_management", "view", { submodule: "onboarding" }), getOnboardingEmployeeById);
router.post('/', requirePermission("hr_management", "create", { submodule: "onboarding" }), createOnboardingEmployee);
router.put('/:id', requirePermission("hr_management", "update", { submodule: "onboarding" }), updateOnboardingEmployee);
router.delete('/:id', requirePermission("hr_management", "delete", { submodule: "onboarding" }), deleteOnboardingEmployee);

// Tasks routes
router.post('/:id/tasks', requirePermission("hr_management", "create", { submodule: "onboarding" }), createOnboardingTask);
router.patch('/tasks/:taskId/toggle', requirePermission("hr_management", "update", { submodule: "onboarding" }), toggleTaskCompletion);

// Documents routes
router.post('/:id/documents', requirePermission("hr_management", "create", { submodule: "onboarding" }), createOnboardingDocument);
router.patch('/documents/:documentId/upload', requirePermission("hr_management", "update", { submodule: "onboarding" }), updateDocumentUpload);

module.exports = router;
