const db = require('../db/db');
const moment = require('moment');
const Razorpay = require('razorpay');
const crypto = require('crypto');

const getBillingDuration = (billingCycle) => {
  const cycle = String(billingCycle || '').toLowerCase();
  if (['yearly', 'annual', 'year'].includes(cycle)) return { count: 1, unit: 'year' };
  return { count: 1, unit: 'month' };
};

const getEndDateForPlan = (startDate, billingCycle) => {
  const { count, unit } = getBillingDuration(billingCycle);
  return moment(startDate).add(count, unit).toDate();
};

const razorpay = process.env.RAZORPAY_KEY_ID && 
                 process.env.RAZORPAY_KEY_SECRET &&
                 process.env.RAZORPAY_KEY_ID !== 'your_actual_razorpay_key_id_here' &&
                 process.env.RAZORPAY_KEY_SECRET !== 'your_actual_razorpay_key_secret_here'
  ? new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET
    })
  : null;

// Get all subscription plans
const getPlans = async (req, res) => {
  try {
    // Check if storage_gb column exists
    const hasStorageColumn = await checkStorageColumnExists();
    
    let query = db('subscription_plans')
      .where('is_active', true)
      .orderBy('price', 'asc');
    
    // Only select storage_gb if column exists
    if (hasStorageColumn) {
      query = query.select('*');
    } else {
      query = query.select(
        'id', 'name', 'description', 'price', 'max_users', 
        'trial_days', 'billing_cycle', 'is_active', 'created_at', 'updated_at'
      );
    }
    
    const plans = await query;
    
    res.json({
      success: true,
      data: plans
    });
  } catch (error) {
    console.error('Error fetching subscription plans:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch subscription plans'
    });
  }
};

// Create Razorpay order for upgrading subscription
const createUpgradeOrder = async (req, res) => {
  try {
    if (!razorpay) {
      return res.status(500).json({
        success: false,
        message: 'Razorpay is not configured. Please add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to .env file with your actual Razorpay API credentials from https://www.razorpay.com'
      });
    }

    const { plan_id } = req.body;
    // Determine company context: prefer req.user.company_id, allow superadmin to specify company_id in body
    let companyId = req.user && req.user.company_id ? req.user.company_id : null;
    if (!companyId && req.user && req.user.role === 'superadmin' && req.body.company_id) {
      companyId = req.body.company_id;
    }

    if (!companyId) {
      return res.status(400).json({
        success: false,
        message: 'Company context not found. Ensure you are using a company admin account or pass `company_id` in the request body as a superadmin.'
      });
    }

    if (!plan_id) {
      return res.status(400).json({
        success: false,
        message: 'plan_id is required'
      });
    }

    const plan = await db('subscription_plans')
      .where('id', plan_id)
      .first();

    if (!plan) {
      return res.status(404).json({
        success: false,
        message: 'Subscription plan not found'
      });
    }

    // Calculate amount based on billing cycle
    let amount;
    const { count, unit } = getBillingDuration(plan.billing_cycle);
    
    if (unit === 'year') {
      // For yearly billing, calculate with discount (pay for 10 months, get 12)
      amount = Math.round(Number(plan.price) * 10 * 100);
    } else {
      // For monthly billing, use monthly price
      amount = Math.round(Number(plan.price) * 100);
    }
    
    const amountPaise = amount;
    if (!Number.isFinite(amountPaise) || amountPaise <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid plan amount'
      });
    }

    const receipt = `sub_upgrade_${companyId}_${plan_id}_${Date.now()}`;

    const order = await razorpay.orders.create({
      amount: amountPaise,
      currency: 'INR',
      receipt,
      notes: {
        company_id: String(companyId),
        plan_id: String(plan_id)
      }
    });

    return res.json({
      success: true,
      data: {
        order_id: order.id,
        amount: order.amount,
        currency: order.currency,
        plan: {
          id: plan.id,
          name: plan.name,
          price: Number(plan.price),
          billing_cycle: plan.billing_cycle,
          display_price: unit === 'year' ? Math.round(Number(plan.price) * 10) : Number(plan.price)
        },
        key_id: process.env.RAZORPAY_KEY_ID
      }
    });
  } catch (error) {
    console.error('Error creating Razorpay upgrade order:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to create payment order'
    });
  }
};

// Verify Razorpay payment and then upgrade subscription + store payment
const verifyUpgradePayment = async (req, res) => {
  const trx = await db.transaction();

  try {
    if (!razorpay) {
      await trx.rollback();
      return res.status(500).json({
        success: false,
        message: 'Razorpay is not configured on server'
      });
    }

    // Determine company context: prefer req.user.company_id, allow superadmin to specify company_id in body
    let companyId = req.user && req.user.company_id ? req.user.company_id : null;
    if (!companyId && req.user && req.user.role === 'superadmin' && req.body.company_id) {
      companyId = req.body.company_id;
    }

    if (!companyId) {
      await trx.rollback();
      return res.status(400).json({
        success: false,
        message: 'Company context not found. Ensure you are using a company admin account or pass `company_id` in the request body as a superadmin.'
      });
    }
    const {
      plan_id,
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature
    } = req.body;

    if (!plan_id || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      await trx.rollback();
      return res.status(400).json({
        success: false,
        message: 'Missing required payment verification fields'
      });
    }

    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      await trx.rollback();
      return res.status(400).json({
        success: false,
        message: 'Payment verification failed'
      });
    }

    const plan = await trx('subscription_plans')
      .where('id', plan_id)
      .first();

    if (!plan) {
      await trx.rollback();
      return res.status(404).json({
        success: false,
        message: 'Subscription plan not found'
      });
    }

    // Calculate the actual paid amount based on billing cycle
    const { count, unit } = getBillingDuration(plan.billing_cycle);
    const paidAmount = unit === 'year' ? Math.round(Number(plan.price) * 10) : Number(plan.price);

    const startDate = moment().toDate();
    const endDate = getEndDateForPlan(startDate, plan.billing_cycle);

    const currentSubscription = await trx('company_subscriptions')
      .where('company_id', companyId)
      .orderBy('created_at', 'desc')
      .first();

    let subscriptionId;
    if (currentSubscription) {
      await trx('company_subscriptions')
        .where('id', currentSubscription.id)
        .update({
          plan_id: plan_id,
          start_date: startDate,
          end_date: endDate,
          status: 'active',
          max_users: plan.max_users,
          storage_gb: plan.storage_gb || 1,
          paid_amount: paidAmount,
          last_payment_date: new Date(),
          next_billing_date: endDate,
          payment_details: JSON.stringify({
            provider: 'razorpay',
            razorpay_order_id,
            razorpay_payment_id
          }),
          updated_at: new Date()
        });
      subscriptionId = currentSubscription.id;
    } else {
      const inserted = await trx('company_subscriptions').insert({
        company_id: companyId,
        plan_id: plan_id,
        start_date: startDate,
        end_date: endDate,
        status: 'active',
        max_users: plan.max_users,
        storage_gb: plan.storage_gb || 1,
        paid_amount: paidAmount,
        last_payment_date: new Date(),
        next_billing_date: endDate,
        payment_details: JSON.stringify({
          provider: 'razorpay',
          razorpay_order_id,
          razorpay_payment_id
        })
      });
      subscriptionId = inserted[0];
    }

    await trx('subscription_payments').insert({
      company_id: companyId,
      subscription_id: subscriptionId,
      amount: paidAmount,
      payment_method: 'upi',
      transaction_id: razorpay_payment_id,
      payment_reference: razorpay_order_id,
      status: 'completed',
      payment_date: new Date(),
      notes: JSON.stringify({ provider: 'razorpay', razorpay_signature })
    });

    await trx.commit();

    return res.json({
      success: true,
      message: 'Payment verified and subscription upgraded successfully',
      data: {
        subscription_id: subscriptionId,
        plan_name: plan.name,
        amount_paid: paidAmount,
        next_billing_date: endDate
      }
    });
  } catch (error) {
    console.error('Error verifying upgrade payment:', error);
    try { await trx.rollback(); } catch (e) {}
    return res.status(500).json({
      success: false,
      message: 'Failed to verify payment and upgrade subscription'
    });
  }
};

// Get all plans (including inactive) - for admin
const getAllPlans = async (req, res) => {
  try {
    // Check if storage_gb column exists
    const hasStorageColumn = await checkStorageColumnExists();
    
    let query = db('subscription_plans').orderBy('price', 'asc');
    
    // Only select storage_gb if column exists
    if (hasStorageColumn) {
      query = query.select('*');
    } else {
      query = query.select(
        'id', 'name', 'description', 'price', 'max_users', 
        'trial_days', 'billing_cycle', 'is_active', 'created_at', 'updated_at'
      );
    }
    
    const plans = await query;
    
    res.json({
      success: true,
      data: plans
    });
  } catch (error) {
    console.error('Error fetching all subscription plans:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch subscription plans'
    });
  }
};

// Create new subscription plan
const createPlan = async (req, res) => {
  try {
    console.log('Create plan request received:', req.body);
    
    const {
      name,
      description,
      price,
      max_users,
      storage_gb,
      trial_days,
      billing_cycle,
      is_active = true
    } = req.body;

    // Validate required fields
    if (!name || !price || !max_users || !trial_days || !billing_cycle) {
      console.log('Validation failed - missing fields');
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: name, price, max_users, trial_days, billing_cycle'
      });
    }

    // Check if storage_gb column exists before trying to insert it
    const hasStorageColumn = await checkStorageColumnExists();
    
    console.log('Creating plan with data:', { name, description, price, max_users, storage_gb, trial_days, billing_cycle, is_active });

    const planData = {
      name,
      description,
      price,
      max_users,
      trial_days,
      billing_cycle,
      is_active
    };

    // Only add storage_gb if the column exists
    if (hasStorageColumn && storage_gb !== undefined) {
      planData.storage_gb = storage_gb;
    }

    const [planId] = await db('subscription_plans').insert(planData);

    console.log('Plan created successfully with ID:', planId);

    res.status(201).json({
      success: true,
      message: 'Subscription plan created successfully',
      data: { id: planId }
    });
  } catch (error) {
    console.error('Error creating subscription plan:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create subscription plan'
    });
  }
};

// Helper function to check if storage_gb column exists
const checkStorageColumnExists = async () => {
  try {
    const column = await db('subscription_plans')
      .columnInfo()
      .then(columns => columns.storage_gb);
    return !!column;
  } catch (error) {
    console.log('Could not check storage_gb column:', error.message);
    return false;
  }
};

// Update subscription plan
const updatePlan = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      description,
      price,
      max_users,
      storage_gb,
      trial_days,
      billing_cycle,
      is_active
    } = req.body;

    // Check if plan exists
    const existingPlan = await db('subscription_plans').where('id', id).first();
    if (!existingPlan) {
      return res.status(404).json({
        success: false,
        message: 'Subscription plan not found'
      });
    }

    // Check if storage_gb column exists
    const hasStorageColumn = await checkStorageColumnExists();
    
    const updateData = {
      name,
      description,
      price,
      max_users,
      trial_days,
      billing_cycle,
      is_active,
      updated_at: new Date()
    };

    // Only add storage_gb if the column exists and value is provided
    if (hasStorageColumn && storage_gb !== undefined) {
      updateData.storage_gb = storage_gb;
    }

    await db('subscription_plans').where('id', id).update(updateData);

    res.json({
      success: true,
      message: 'Subscription plan updated successfully'
    });
  } catch (error) {
    console.error('Error updating subscription plan:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update subscription plan'
    });
  }
};

// Patch subscription plan (for specific updates like status)
const patchPlan = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    // Check if plan exists
    const existingPlan = await db('subscription_plans').where('id', id).first();
    if (!existingPlan) {
      return res.status(404).json({
        success: false,
        message: 'Subscription plan not found'
      });
    }

    // Check if storage_gb column exists and is being updated
    const hasStorageColumn = await checkStorageColumnExists();
    const finalUpdateData = { ...updateData, updated_at: new Date() };
    
    // Remove storage_gb if column doesn't exist
    if (!hasStorageColumn && finalUpdateData.storage_gb !== undefined) {
      delete finalUpdateData.storage_gb;
    }

    await db('subscription_plans').where('id', id).update(finalUpdateData);

    res.json({
      success: true,
      message: 'Subscription plan updated successfully'
    });
  } catch (error) {
    console.error('Error updating subscription plan:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update subscription plan'
    });
  }
};

// Delete subscription plan
const deletePlan = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if plan exists
    const existingPlan = await db('subscription_plans').where('id', id).first();
    if (!existingPlan) {
      return res.status(404).json({
        success: false,
        message: 'Subscription plan not found'
      });
    }

    // Check if plan is being used by any active subscriptions
    const activeSubscriptions = await db('company_subscriptions')
      .where('plan_id', id)
      .whereIn('status', ['trial', 'active'])
      .first();

    if (activeSubscriptions) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete plan that is being used by active subscriptions'
      });
    }

    await db('subscription_plans').where('id', id).del();

    res.json({
      success: true,
      message: 'Subscription plan deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting subscription plan:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete subscription plan'
    });
  }
};

// Get all subscriptions (for superadmin)
const getAllSubscriptions = async (req, res) => {
  try {
    const subscriptions = await db('company_subscriptions')
      .select(
        'company_subscriptions.*',
        'subscription_plans.name as plan_name',
        'subscription_plans.price as plan_price',
        'subscription_plans.max_users as plan_max_users',
        'companies.company_name'
      )
      .join('subscription_plans', 'company_subscriptions.plan_id', 'subscription_plans.id')
      .join('companies', 'company_subscriptions.company_id', 'companies.id')
      .orderBy('company_subscriptions.created_at', 'desc');

    res.json({
      success: true,
      data: subscriptions
    });
  } catch (error) {
    console.error('Error fetching all subscriptions:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch subscriptions'
    });
  }
};

// Get company's current subscription
const getCompanySubscription = async (req, res) => {
  try {
    const companyId = req.user.company_id;
    
    const subscription = await db('company_subscriptions')
      .select(
        'company_subscriptions.*',
        'subscription_plans.name as plan_name',
        'subscription_plans.description as plan_description',
        'subscription_plans.price as plan_price',
        'subscription_plans.max_users as plan_max_users',
        'subscription_plans.billing_cycle as plan_billing_cycle',
        'subscription_plans.storage_gb as plan_storage_gb'
      )
      .join('subscription_plans', 'company_subscriptions.plan_id', 'subscription_plans.id')
      .where('company_subscriptions.company_id', companyId)
      .orderBy('company_subscriptions.created_at', 'desc')
      .first();

    if (!subscription) {
      return res.json({
        success: true,
        data: null,
        message: 'No active subscription found'
      });
    }

    // Calculate days remaining
    const today = moment();
    const endDate = moment(subscription.end_date);
    const daysRemaining = endDate.diff(today, 'days');
    
    // Check if trial is active (trial is active only if today is before trial_end_date)
    const isTrialActive = subscription.status === 'trial' && 
                         moment().startOf('day').isBefore(moment(subscription.trial_end_date).startOf('day'));

    res.json({
      success: true,
      data: {
        ...subscription,
        days_remaining: Math.max(0, daysRemaining),
        is_trial_active: isTrialActive,
        trial_days_remaining: isTrialActive ? 
          moment(subscription.trial_end_date).diff(today, 'days') : Math.max(0, moment(subscription.trial_end_date).diff(today, 'days')),
        storage_usage_percentage: subscription.storage_gb > 0 ? 
          Math.round((subscription.used_storage_mb || 0) / (subscription.storage_gb * 1024) * 100) : 0
      }
    });
  } catch (error) {
    console.error('Error fetching company subscription:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch subscription details'
    });
  }
};

// Start free trial
const startTrial = async (req, res) => {
  try {
    const { plan_id } = req.body;
    const companyId = req.user.company_id;

    // Check if company already has an active trial or subscription
    const existingSubscription = await db('company_subscriptions')
      .where('company_id', companyId)
      .whereIn('status', ['trial', 'active'])
      .first();

    if (existingSubscription) {
      return res.status(400).json({
        success: false,
        message: 'Company already has an active subscription or trial'
      });
    }

    // Get plan details
    const plan = await db('subscription_plans')
      .where('id', plan_id)
      .first();

    if (!plan) {
      return res.status(404).json({
        success: false,
        message: 'Subscription plan not found'
      });
    }

    const startDate = moment().toDate();
    const trialEndDate = moment(startDate).add(plan.trial_days, 'days').toDate();
    const endDate = getEndDateForPlan(trialEndDate, plan.billing_cycle);

    // Create trial subscription
    const [subscriptionId] = await db('company_subscriptions').insert({
      company_id: companyId,
      plan_id: plan_id,
      start_date: startDate,
      end_date: endDate,
      trial_end_date: trialEndDate,
      status: 'trial',
      max_users: plan.max_users,
      storage_gb: plan.storage_gb || 1,
      next_billing_date: trialEndDate
    });

    res.status(201).json({
      success: true,
      message: `Free trial started successfully. Trial ends on ${moment(trialEndDate).format('DD MMM YYYY')}`,
      data: {
        subscription_id: subscriptionId,
        trial_end_date: trialEndDate,
        plan_name: plan.name
      }
    });
  } catch (error) {
    console.error('Error starting trial:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to start free trial'
    });
  }
};

// Upgrade/Change subscription plan
const upgradeSubscription = async (req, res) => {
  try {
    const { plan_id, payment_method, payment_details } = req.body;
    const companyId = req.user.company_id;

    // Get plan details
    const plan = await db('subscription_plans')
      .where('id', plan_id)
      .first();

    if (!plan) {
      return res.status(404).json({
        success: false,
        message: 'Subscription plan not found'
      });
    }

    // Get current subscription
    const currentSubscription = await db('company_subscriptions')
      .where('company_id', companyId)
      .orderBy('created_at', 'desc')
      .first();

    // Calculate the actual paid amount based on billing cycle
    const { count, unit } = getBillingDuration(plan.billing_cycle);
    const paidAmount = unit === 'year' ? Math.round(Number(plan.price) * 10) : Number(plan.price);

    const startDate = moment().toDate();
    const endDate = getEndDateForPlan(startDate, plan.billing_cycle);

    let subscriptionId;
    
    if (currentSubscription) {
      // Update existing subscription
      await db('company_subscriptions')
        .where('id', currentSubscription.id)
        .update({
          plan_id: plan_id,
          start_date: startDate,
          end_date: endDate,
          status: 'active',
          max_users: plan.max_users,
          storage_gb: plan.storage_gb || 1,
          paid_amount: paidAmount,
          last_payment_date: new Date(),
          next_billing_date: endDate,
          updated_at: new Date()
        });
      subscriptionId = currentSubscription.id;
    } else {
      // Create new subscription
      [subscriptionId] = await db('company_subscriptions').insert({
        company_id: companyId,
        plan_id: plan_id,
        start_date: startDate,
        end_date: endDate,
        status: 'active',
        max_users: plan.max_users,
        storage_gb: plan.storage_gb || 1,
        paid_amount: paidAmount,
        last_payment_date: new Date(),
        next_billing_date: endDate
      });
    }

    // Record payment
    await db('subscription_payments').insert({
      company_id: companyId,
      subscription_id: subscriptionId,
      amount: paidAmount,
      payment_method: payment_method,
      transaction_id: `TXN${Date.now()}`,
      payment_reference: payment_details,
      status: 'completed',
      payment_date: new Date()
    });

    res.json({
      success: true,
      message: 'Subscription upgraded successfully',
      data: {
        subscription_id: subscriptionId,
        plan_name: plan.name,
        amount_paid: paidAmount,
        next_billing_date: endDate
      }
    });
  } catch (error) {
    console.error('Error upgrading subscription:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upgrade subscription'
    });
  }
};

// Get payment history
const getPaymentHistory = async (req, res) => {
  try {
    const companyId = req.user.company_id;
    
    const payments = await db('subscription_payments')
      .where('company_id', companyId)
      .orderBy('payment_date', 'desc');

    res.json({
      success: true,
      data: payments
    });
  } catch (error) {
    console.error('Error fetching payment history:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch payment history'
    });
  }
};

// Check subscription status (middleware helper)
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

    // Check user limit
    const currentUsers = await db('employee')
      .where('company_id', companyId)
      .where('is_active', 1)
      .count('* as count')
      .first();

    if (parseInt(currentUsers.count) > subscription.max_users) {
      return res.status(403).json({
        success: false,
        message: `User limit exceeded. Your plan allows ${subscription.max_users} users, but you have ${currentUsers.count}. Please upgrade your plan.`,
        user_limit_exceeded: true
      });
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

// Update storage usage for a company
const updateStorageUsage = async (companyId) => {
  try {
    // Calculate total storage used by company uploads
    const fs = require('fs').promises;
    const path = require('path');
    
    const companyUploadsPath = path.join(__dirname, '../uploads/company_', companyId);
    let totalSizeMB = 0;

    try {
      const files = await fs.readdir(companyUploadsPath, { withFileTypes: true });
      
      for (const file of files) {
        if (file.isFile()) {
          const filePath = path.join(companyUploadsPath, file.name);
          const stats = await fs.stat(filePath);
          totalSizeMB += Math.round(stats.size / (1024 * 1024)); // Convert bytes to MB
        } else if (file.isDirectory()) {
          // Recursively calculate directory sizes
          const dirPath = path.join(companyUploadsPath, file.name);
          const dirSize = await calculateDirectorySize(dirPath);
          totalSizeMB += Math.round(dirSize / (1024 * 1024));
        }
      }
    } catch (error) {
      // Directory doesn't exist or is not accessible
      console.log(`Upload directory not found for company ${companyId}, assuming 0 MB used`);
    }

    // Update the subscription with current storage usage
    await db('company_subscriptions')
      .where('company_id', companyId)
      .update({
        used_storage_mb: totalSizeMB,
        updated_at: new Date()
      });

    return totalSizeMB;
  } catch (error) {
    console.error('Error updating storage usage:', error);
    throw error;
  }
};

// Helper function to calculate directory size recursively
const calculateDirectorySize = async (dirPath) => {
  const fs = require('fs').promises;
  const path = require('path');
  let totalSize = 0;

  try {
    const items = await fs.readdir(dirPath, { withFileTypes: true });
    
    for (const item of items) {
      const itemPath = path.join(dirPath, item.name);
      
      if (item.isFile()) {
        const stats = await fs.stat(itemPath);
        totalSize += stats.size;
      } else if (item.isDirectory()) {
        totalSize += await calculateDirectorySize(itemPath);
      }
    }
  } catch (error) {
    // Directory not accessible
    console.log(`Cannot access directory: ${dirPath}`);
  }

  return totalSize;
};

// Check storage limit before file upload
const checkStorageLimit = async (req, res, next) => {
  try {
    const companyId = req.user.company_id;
    
    // Get current subscription
    const subscription = await db('company_subscriptions')
      .where('company_id', companyId)
      .whereIn('status', ['trial', 'active'])
      .first();

    if (!subscription) {
      return res.status(403).json({
        success: false,
        message: 'No active subscription found.',
        requires_subscription: true
      });
    }

    // Update current storage usage
    const currentUsageMB = await updateStorageUsage(companyId);
    const maxStorageMB = (subscription.storage_gb || 1) * 1024; // Convert GB to MB

    // Check if adding new file would exceed storage limit
    // Assuming file size will be in req.file.size if multer is used
    const fileSizeMB = req.file ? Math.round(req.file.size / (1024 * 1024)) : 0;
    const projectedUsage = currentUsageMB + fileSizeMB;

    if (projectedUsage > maxStorageMB) {
      const availableMB = maxStorageMB - currentUsageMB;
      return res.status(413).json({
        success: false,
        message: `Storage limit exceeded. Your plan allows ${subscription.storage_gb}GB, but you're currently using ${Math.round(currentUsageMB / 1024 * 100) / 100}GB. Only ${Math.round(availableMB)}MB available. Please upgrade your plan for more storage.`,
        storage_limit_exceeded: true,
        current_usage: currentUsageMB,
        max_storage: maxStorageMB,
        available_storage: availableMB
      });
    }

    req.storageInfo = {
      current_usage_mb: currentUsageMB,
      max_storage_mb: maxStorageMB,
      available_mb: maxStorageMB - currentUsageMB
    };

    next();
  } catch (error) {
    console.error('Error checking storage limit:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check storage limit'
    });
  }
};

module.exports = {
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
  checkSubscriptionStatus,
  updateStorageUsage,
  checkStorageLimit
};
