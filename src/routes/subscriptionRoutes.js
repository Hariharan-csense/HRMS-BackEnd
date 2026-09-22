const { requestDeletion } = require("../middleware/deletionApproval");
const express = require('express');
const router = express.Router();
const {
  getPlans,
  getAllPlans,
  createPlan,
  updatePlan,
  patchPlan,
  deletePlan,
  getAllSubscriptions,
  getCompanySubscription,
  startTrial,
  upgradeSubscription,
  createUpgradeOrder,
  verifyUpgradePayment,
  getAddons,
  getAvailableAddons,
  createAddon,
  updateAddon,
  deleteAddon,
  createAddonOrder,
  verifyAddonPayment,
  assignAddonToCompany,
  removeCompanyAddon,
  getAddonUserAssignments,
  updateAddonUserAssignments,
  getPaymentHistory,
  checkSubscriptionStatus
} = require('../controllers/subscriptionController');
const {protect, superAdminOnly} = require('../middleware/authMiddleware');
const { requirePermission } = require("../middleware/rbacMiddleware");

// Public endpoint - get available plans (no auth required for basic plans)
router.get('/plans', getPlans);

// Test endpoint
router.get('/test', (req, res) => {
  res.json({ message: 'Subscription API is working!' });
});

// Apply authentication middleware to all other routes
router.use(protect);

// Company admin add-on purchase routes
router.get('/addons/available', requirePermission("subscription", "view"), getAvailableAddons);
router.post('/addons/create-order', requirePermission("subscription", "update"), createAddonOrder);
router.post('/addons/verify-payment', requirePermission("subscription", "update"), verifyAddonPayment);
router.get('/addons/assignments', requirePermission("subscription", "view"), getAddonUserAssignments);
router.put('/addons/assignments/:subscriptionAddonId/users', requirePermission("subscription", "update"), updateAddonUserAssignments);

// SuperAdmin-only plan management routes
router.get('/plans/all', superAdminOnly, requirePermission("subscription_plans", "view"), getAllPlans);
router.post('/plans', superAdminOnly, requirePermission("subscription_plans", "create"), createPlan);
router.put('/plans/:id', superAdminOnly, requirePermission("subscription_plans", "update"), updatePlan);
router.patch('/plans/:id', superAdminOnly, requirePermission("subscription_plans", "update"), patchPlan);
router.delete('/plans/:id', superAdminOnly, requirePermission("subscription_plans", "delete"), requestDeletion("subscription_plan"));

// SuperAdmin-only add-on package management routes
router.get('/addons', superAdminOnly, requirePermission("subscription_plans", "view"), getAddons);
router.post('/addons', superAdminOnly, requirePermission("subscription_plans", "create"), createAddon);
router.put('/addons/:id', superAdminOnly, requirePermission("subscription_plans", "update"), updateAddon);
router.delete('/addons/:id', superAdminOnly, requirePermission("subscription_plans", "delete"), requestDeletion("subscription_addon"));
router.post('/addons/assign', superAdminOnly, requirePermission("subscription_plans", "update"), assignAddonToCompany);
router.delete('/addons/assignments/:assignmentId', superAdminOnly, requirePermission("subscription_plans", "update"), requestDeletion("company_addon", {"param":"assignmentId"}));

// SuperAdmin-only subscription management routes
router.get('/all', superAdminOnly, requirePermission("subscription_plans", "view"), getAllSubscriptions);

// Admin/Company subscription routes (authenticated users)
router.get('/current',  getCompanySubscription);
router.post('/start-trial', requirePermission("subscription", "create"), startTrial);
router.post('/upgrade', requirePermission("subscription", "update"), upgradeSubscription);
router.post('/upgrade/create-order', requirePermission("subscription", "update"), createUpgradeOrder);
router.post('/upgrade/verify-payment', requirePermission("subscription", "update"), verifyUpgradePayment);
router.get('/payments', requirePermission("subscription", "view"), getPaymentHistory);

// Middleware to check subscription status (can be used on protected routes)
router.use('/check-status', checkSubscriptionStatus);

module.exports = router;
