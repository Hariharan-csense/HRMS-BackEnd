const db = require('../db/db');

const getActiveSubscriptionQuery = (companyId) =>
  db('company_subscriptions')
    .select('company_subscriptions.*')
    .where('company_subscriptions.company_id', companyId)
    .where(function () {
      this.where(function () {
        this.where('company_subscriptions.status', 'trial')
          .andWhere('company_subscriptions.trial_end_date', '>=', db.fn.now());
      }).orWhere(function () {
        this.where('company_subscriptions.status', 'active')
          .andWhere('company_subscriptions.end_date', '>=', db.fn.now());
      });
    })
    .orderBy('company_subscriptions.created_at', 'desc');

// Middleware to check subscription status for user creation
const checkUserCreationSubscription = async (req, res, next) => {
  try {
    const companyId = req.user.company_id;

    if (!companyId) {
      return res.status(400).json({ 
        message: 'You are not assigned to any company' 
      });
    }

    const hasRequestedPlan = Boolean(req.body?.subscription_plan_id);
    const hasRequestedCycle = Boolean(req.body?.subscription_billing_cycle);
    if (!hasRequestedPlan && !hasRequestedCycle) {
      req.subscription = null;
      req.userCount = 0;
      req.maxUsers = 0;
      return next();
    }

    const requestedCycle = ["yearly", "annual", "year"].includes(
      String(req.body?.subscription_billing_cycle || "monthly").toLowerCase(),
    )
      ? "yearly"
      : "monthly";
    const requestedPlanId = Number(req.body?.subscription_plan_id || 0);

    const activeSubscriptions = await getActiveSubscriptionQuery(companyId);
    const trialSubscription = activeSubscriptions.find(
      (item) => item.status === "trial",
    );
    const subscription =
      trialSubscription ||
      activeSubscriptions.find(
        (item) =>
          String(item.billing_cycle || "monthly").toLowerCase() ===
            requestedCycle &&
          (!requestedPlanId || Number(item.plan_id) === requestedPlanId),
      );

    if (!subscription) {
      if (activeSubscriptions.length > 0) {
        return res.status(403).json({
          message: `No active package with ${requestedCycle} billing seats is available. Please select a purchased package or buy seats first.`,
          user_limit_exceeded: true,
          billing_cycle: requestedCycle,
          current_users: 0,
          max_users: 0,
        });
      }
      req.subscription = null;
      req.userCount = 0;
      req.maxUsers = 0;
      return next();
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
      .modify((queryBuilder) => {
        if (subscription.status !== "trial") {
          queryBuilder
            .where("subscription_billing_cycle", requestedCycle)
            .where("subscription_plan_id", subscription.plan_id);
        }
      })
      .count('* as count')
      .first();

    const currentUsers = parseInt(currentEmployeeCount.count, 10) || 0;
    const maxUsers = Number(subscription.max_users || 0);

    if (maxUsers > 0 && currentUsers >= maxUsers) {
      return res.status(403).json({
        message: `${requestedCycle === "yearly" ? "Yearly" : "Monthly"} seat limit exceeded. You have ${maxUsers} seats and all are assigned. Please purchase more ${requestedCycle} seats.`,
        user_limit_exceeded: true,
        current_users: currentUsers,
        max_users: maxUsers
      });
    }

    // Attach subscription info to request for use in controllers
    req.subscription = subscription;
    req.userCount = currentUsers;
    req.maxUsers = maxUsers;
    req.subscriptionBillingCycle = requestedCycle;
    req.subscriptionPlanId = Number(subscription.plan_id);
    
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
    
    const subscription = await getActiveSubscriptionQuery(companyId)
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
