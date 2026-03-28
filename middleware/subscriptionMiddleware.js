const db = require('../db/db');

// Middleware to check subscription status for user creation
const checkUserCreationSubscription = async (req, res, next) => {
  try {
    const companyId = req.user.company_id;

    if (!companyId) {
      return res.status(400).json({ 
        message: 'You are not assigned to any company' 
      });
    }

    // Get company's current subscription
    const subscription = await db('company_subscriptions')
      .select(
        'company_subscriptions.*',
        'subscription_plans.max_users as plan_max_users',
        'subscription_plans.trial_days as plan_trial_days'
      )
      .join('subscription_plans', 'company_subscriptions.plan_id', 'subscription_plans.id')
      .where('company_subscriptions.company_id', companyId)
      .whereIn('company_subscriptions.status', ['trial', 'active'])
      .where('company_subscriptions.end_date', '>=', db.fn.now())
      .orderBy('company_subscriptions.created_at', 'desc')
      .first();

    if (!subscription) {
      return res.status(403).json({
        message: 'No active subscription found. Please subscribe to continue.',
        requires_subscription: true
      });
    }

    // Check if trial has expired
    if (subscription.status === 'trial' && subscription.trial_end_date) {
      const trialEndDate = new Date(subscription.trial_end_date);
      const currentDate = new Date();
      
      if (currentDate > trialEndDate) {
        return res.status(403).json({
          message: `Your trial period has expired on ${trialEndDate.toDateString()}. Please subscribe to continue.`,
          trial_expired: true,
          trial_end_date: trialEndDate
        });
      }
    }

    // Get current employee count
    const currentEmployeeCount = await db('employees')
      .where('company_id', companyId)
      .count('* as count')
      .first();

    const currentUsers = parseInt(currentEmployeeCount.count);
    const maxUsers = subscription.max_users || subscription.plan_max_users;

    if (currentUsers >= maxUsers) {
      return res.status(403).json({
        message: `User limit exceeded. Your plan allows ${maxUsers} users, but you already have ${currentUsers}. Please upgrade your plan to add more employees.`,
        user_limit_exceeded: true,
        current_users: currentUsers,
        max_users: maxUsers
      });
    }

    // Attach subscription info to request for use in controllers
    req.subscription = subscription;
    req.userCount = currentUsers;
    req.maxUsers = maxUsers;
    
    next();
  } catch (error) {
    console.error('Error checking subscription:', error);
    return res.status(500).json({
      message: 'Failed to verify subscription status. Please try again.'
    });
  }
};

// General subscription status checker (for other routes)
const checkSubscriptionStatus = async (req, res, next) => {
  try {
    const companyId = req.user.company_id;
    
    const subscription = await db('company_subscriptions')
      .where('company_id', companyId)
      .whereIn('status', ['trial', 'active'])
      .where('end_date', '>=', db.fn.now())
      .first();

    if (!subscription) {
      return res.status(403).json({
        success: false,
        message: 'No active subscription found. Please upgrade to continue using the service.',
        requires_subscription: true
      });
    }

    // Check trial expiration
    if (subscription.status === 'trial' && subscription.trial_end_date) {
      const trialEndDate = new Date(subscription.trial_end_date);
      const currentDate = new Date();
      
      if (currentDate > trialEndDate) {
        return res.status(403).json({
          success: false,
          message: `Your trial period has expired on ${trialEndDate.toDateString()}. Please subscribe to continue.`,
          trial_expired: true
        });
      }
    }

    req.subscription = subscription;
    next();
  } catch (error) {
    console.error('Error checking subscription status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify subscription status'
    });
  }
};

module.exports = { 
  checkUserCreationSubscription,
  checkSubscriptionStatus 
};
