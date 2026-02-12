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
  getPaymentHistory,
  checkSubscriptionStatus
} = require('../controllers/subscriptionController');
const {protect, adminOnly, superAdminOnly} = require('../middleware/authMiddleware');

// Public endpoint - get available plans (no auth required for basic plans)
router.get('/plans', getPlans);

// Test endpoint
router.get('/test', (req, res) => {
  res.json({ message: 'Subscription API is working!' });
});

// Apply authentication middleware to all other routes
router.use(protect);

// SuperAdmin-only plan management routes
router.get('/plans/all', superAdminOnly, getAllPlans);
router.post('/plans', superAdminOnly, createPlan);
router.put('/plans/:id', superAdminOnly, updatePlan);
router.patch('/plans/:id', superAdminOnly, patchPlan);
router.delete('/plans/:id', superAdminOnly, deletePlan);

// SuperAdmin-only subscription management routes
router.get('/all', superAdminOnly, getAllSubscriptions);

// Admin/Company subscription routes (authenticated users)
router.use(adminOnly);
router.get('/current', getCompanySubscription);
router.post('/start-trial', startTrial);
router.post('/upgrade', upgradeSubscription);
router.post('/upgrade/create-order', createUpgradeOrder);
router.post('/upgrade/verify-payment', verifyUpgradePayment);
router.get('/payments', getPaymentHistory);

// Middleware to check subscription status (can be used on protected routes)
router.use('/check-status', checkSubscriptionStatus);

module.exports = router;
