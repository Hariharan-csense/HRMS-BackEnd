const db = require("../db/db");
const moment = require("moment");
const Razorpay = require("razorpay");
const crypto = require("crypto");
const {
  getAddonModuleAliases,
  normalizeModuleKey: normalizeAddonModuleKey,
} = require("../utils/subscriptionAddons");

const getBillingDuration = (billingCycle) => {
  const cycle = String(billingCycle || "").toLowerCase();
  if (["yearly", "annual", "year"].includes(cycle))
    return { count: 1, unit: "year" };
  return { count: 1, unit: "month" };
};

const normalizeBillingCycle = (billingCycle) => {
  const cycle = String(billingCycle || "").toLowerCase();
  if (["yearly", "annual", "year"].includes(cycle)) return "yearly";
  return "monthly";
};

const roundMoney = (value) => Math.round(Number(value || 0) * 100) / 100;

const getPlanSchemaInfo = async () => {
  try {
    return await db("subscription_plans").columnInfo();
  } catch (error) {
    console.log("Could not inspect subscription_plans schema:", error.message);
    return {};
  }
};

const getPlanMonthlyPriceField = (columns = {}) =>
  columns.monthly_price ? "monthly_price" : "price";
const getPlanYearlyPriceField = (columns = {}) =>
  columns.yearly_price ? "yearly_price" : null;
const getPlanStorageField = (columns = {}) =>
  columns.storage_gb ? "storage_gb" : null;
const getPlanMaxUsersField = (columns = {}) =>
  columns.max_users ? "max_users" : null;

const isFreePlanName = (planName) => {
  const normalized = String(planName || "")
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
  if (!normalized) return false;
  if (normalized.includes("freeplan") || normalized.includes("freepackage"))
    return true;
  return normalized.includes("free") && !normalized.includes("trial");
};

const resolvePlanPricingFields = (
  planName,
  { price, yearly_price, trial_days } = {},
) => {
  if (isFreePlanName(planName)) {
    return { price: 0, yearly_price: 0, trial_days: 0 };
  }

  return {
    price:
      price === undefined || price === null || price === ""
        ? undefined
        : Number(price),
    yearly_price:
      yearly_price === undefined || yearly_price === null || yearly_price === ""
        ? undefined
        : Number(yearly_price),
    trial_days:
      trial_days === undefined || trial_days === null || trial_days === ""
        ? undefined
        : Number(trial_days),
  };
};

const parseOptionalNumber = (value) => {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const resolvePlanStorageGb = (planName, storage_gb) => {
  const parsed = parseOptionalNumber(storage_gb);
  if (parsed !== undefined) return parsed;
  return isFreePlanName(planName) ? 0 : 1;
};

const resolveSelectedUsers = (usersCount) => {
  const parsed = Number(usersCount || 1);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
};

const getTierPrice = (record, usersCount, billingCycle = "monthly") => {
  if (!record) return 0;
  const normalizedCycle = normalizeBillingCycle(billingCycle);
  const resolvedPrice =
    normalizedCycle === "yearly"
      ? (record.yearly_price ?? record.yearlyPrice)
      : (record.monthly_price ?? record.price);
  return Number(resolvedPrice || 0);
};

const getEndDateForPlan = (startDate, billingCycle) => {
  const { count, unit } = getBillingDuration(billingCycle);
  return moment(startDate).add(count, unit).toDate();
};

const normalizeModuleKey = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const inferAddonModuleKey = (addon = {}) => {
  const text =
    `${addon.module_key || ""} ${addon.name || ""} ${addon.description || ""}`.toLowerCase();
  if (
    (text.includes("live") && text.includes("tracking")) ||
    text.includes("tracking_management") ||
    text.includes("tracking management")
  )
    return "live_tracking";
  if (text.includes("client") && text.includes("attendance"))
    return "client_attendance";
  if (text.includes("expense")) return "expenses";
  if (text.includes("helpdesk")) return "hr_helpdesk";
  if (text.includes("ticket")) return "tickets";
  if (
    text.includes("ai_assistant") ||
    text.includes("ai assistant") ||
    text.includes("ai chat") ||
    text.includes("chatbot")
  )
    return "ai_assistant";
  if (text.includes("roster") || text.includes("shift_roster"))
    return "shift_roster";
  if (text.includes("asset")) return "assets";
  if (text.includes("payroll_audit") || text.includes("audit trail"))
    return "payroll_audit";
  if (text.includes("payroll")) return "payroll";
  if (
    text.includes("rms") ||
    text.includes("recruitment") ||
    text.includes("hr management")
  )
    return "hr_management";
  if (text.includes("exit") || text.includes("offboarding")) return "exit";
  if (text.includes("kpi")) return "kpi";
  return normalizeModuleKey(addon.module_key || addon.name);
};

const getAddonPriceForUsers = (addon, usersCount) => {
  const count = Number(usersCount || 0);
  if (count <= 5) return Number(addon.price_upto25 || 0);
  if (count <= 10) return Number(addon.price_upto50 || addon.price_upto25 || 0);
  return Number(
    addon.price_above50 || addon.price_upto50 || addon.price_upto25 || 0,
  );
};

const getSubscriptionAddons = async (subscriptionId, trx = db) => {
  if (!subscriptionId) return [];

  const hasCompanyAddons = await trx.schema.hasTable(
    "company_subscription_addons",
  );
  const hasAddons = await trx.schema.hasTable("subscription_addons");
  if (!hasCompanyAddons || !hasAddons) return [];

  const addonColumns = await trx("subscription_addons").columnInfo();
  const moduleKeySelect = addonColumns.module_key
    ? "subscription_addons.module_key"
    : trx.raw("NULL as module_key");

  const rows = await trx("company_subscription_addons")
    .join(
      "subscription_addons",
      "company_subscription_addons.addon_id",
      "subscription_addons.id",
    )
    .where("company_subscription_addons.subscription_id", subscriptionId)
    .where("subscription_addons.is_active", true)
    .select(
      "company_subscription_addons.id",
      "company_subscription_addons.addon_id",
      "company_subscription_addons.users_count",
      "company_subscription_addons.billing_cycle",
      "company_subscription_addons.price_per_user",
      "company_subscription_addons.total_price",
      "subscription_addons.name",
      "subscription_addons.description",
      moduleKeySelect,
    )
    .orderBy("subscription_addons.name", "asc");

  let assignmentRows = [];
  const hasAssignments = await trx.schema.hasTable(
    "company_addon_user_assignments",
  );
  if (hasAssignments && rows.length > 0) {
    assignmentRows = await trx("company_addon_user_assignments")
      .whereIn(
        "subscription_addon_id",
        rows.map((row) => row.id),
      )
      .select("subscription_addon_id", "employee_id");
  }

  return rows.map((addon) => ({
    ...addon,
    module_key: inferAddonModuleKey(addon),
    users_count: Number(addon.users_count || 0),
    price_per_user: Number(addon.price_per_user || 0),
    total_price: Number(addon.total_price || 0),
    assigned_employee_ids: assignmentRows
      .filter(
        (assignment) =>
          Number(assignment.subscription_addon_id) === Number(addon.id),
      )
      .map((assignment) => Number(assignment.employee_id)),
  }));
};

const razorpay =
  process.env.RAZORPAY_KEY_ID &&
  process.env.RAZORPAY_KEY_SECRET &&
  process.env.RAZORPAY_KEY_ID !== "your_actual_razorpay_key_id_here" &&
  process.env.RAZORPAY_KEY_SECRET !== "your_actual_razorpay_key_secret_here"
    ? new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID,
        key_secret: process.env.RAZORPAY_KEY_SECRET,
      })
    : null;

const computePricing = (plan, usersCount, billingCycle) => {
  const normalizedCycle = normalizeBillingCycle(billingCycle);
  const basePerUser = getTierPrice(plan, usersCount, normalizedCycle);
  const totalAmount = roundMoney(
    basePerUser *
      Number(usersCount || 0) *
      (normalizedCycle === "yearly" ? 12 : 1),
  );

  return {
    billing_cycle: normalizedCycle,
    base_per_user: basePerUser,
    per_user_monthly: basePerUser,
    per_user_total: basePerUser,
    total_amount: totalAmount,
  };
};

const computeSeatMixPricing = (plan, payload = {}) => {
  const mixed = payload.monthly_users !== undefined || payload.yearly_users !== undefined;
  if (!mixed) {
    const users = resolveSelectedUsers(payload.users_count);
    const item = computePricing(plan, users, payload.billing_cycle);
    return {
      monthly_users: item.billing_cycle === "monthly" ? users : 0,
      yearly_users: item.billing_cycle === "yearly" ? users : 0,
      monthly_amount: item.billing_cycle === "monthly" ? item.total_amount : 0,
      yearly_amount: item.billing_cycle === "yearly" ? item.total_amount : 0,
      total_users: users,
      total_amount: item.total_amount,
      total_payable: roundMoney(item.total_amount * 1.18),
    };
  }
  const monthlyUsers = Math.max(0, Math.floor(Number(payload.monthly_users || 0)));
  const yearlyUsers = Math.max(0, Math.floor(Number(payload.yearly_users || 0)));
  const monthly = computePricing(plan, monthlyUsers, "monthly");
  const yearly = computePricing(plan, yearlyUsers, "yearly");
  return {
    monthly_users: monthlyUsers,
    yearly_users: yearlyUsers,
    monthly_amount: monthly.total_amount,
    yearly_amount: yearly.total_amount,
    total_users: monthlyUsers + yearlyUsers,
    total_amount: roundMoney(monthly.total_amount + yearly.total_amount),
    total_payable: roundMoney(
      (monthly.total_amount + yearly.total_amount) * 1.18,
    ),
  };
};

// Get all subscription plans
const getPlans = async (req, res) => {
  try {
    const planColumns = await getPlanSchemaInfo();
    const monthlyPriceField = getPlanMonthlyPriceField(planColumns);
    const yearlyPriceField = getPlanYearlyPriceField(planColumns);
    const storageField = getPlanStorageField(planColumns);
    const maxUsersField = getPlanMaxUsersField(planColumns);

    let query = db("subscription_plans")
      .where("is_active", true)
      .orderBy(monthlyPriceField, "asc")
      .select(
        "id",
        "name",
        "description",
        `${monthlyPriceField} as price`,
        yearlyPriceField
          ? `${yearlyPriceField} as yearly_price`
          : db.raw("NULL as yearly_price"),
        maxUsersField
          ? `${maxUsersField} as max_users`
          : db.raw("0 as max_users"),
        storageField
          ? `${storageField} as storage_gb`
          : db.raw("NULL as storage_gb"),
        "trial_days",
        "is_active",
        "created_at",
        "updated_at",
      );

    const plans = await query;

    res.json({
      success: true,
      data: plans,
    });
  } catch (error) {
    console.error("Error fetching subscription plans:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch subscription plans",
    });
  }
};

// Create Razorpay order for upgrading subscription
const createUpgradeOrder = async (req, res) => {
  try {
    if (!razorpay) {
      return res.status(500).json({
        success: false,
        message:
          "Razorpay is not configured. Please add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to .env file with your actual Razorpay API credentials from https://www.razorpay.com",
      });
    }

    const { plan_id } = req.body;
    // Determine company context: prefer req.user.company_id, allow superadmin to specify company_id in body
    let companyId =
      req.user && req.user.company_id ? req.user.company_id : null;
    if (
      !companyId &&
      req.user &&
      req.user.role === "superadmin" &&
      req.body.company_id
    ) {
      companyId = req.body.company_id;
    }

    if (!companyId) {
      return res.status(400).json({
        success: false,
        message:
          "Company context not found. Ensure you are using a company admin account or pass `company_id` in the request body as a superadmin.",
      });
    }

    if (!plan_id) {
      return res.status(400).json({
        success: false,
        message: "plan_id is required",
      });
    }

    const plan = await db("subscription_plans").where("id", plan_id).first();

    if (!plan) {
      return res.status(404).json({
        success: false,
        message: "Subscription plan not found",
      });
    }

    const pricing = computeSeatMixPricing(plan, req.body);
    if (pricing.total_users <= 0) {
      return res.status(400).json({
        success: false,
        message: "Select at least one monthly or yearly user",
      });
    }

    const amountPaise = Math.round(Number(pricing.total_payable) * 100);
    if (!Number.isFinite(amountPaise) || amountPaise <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid plan amount",
      });
    }

    const receipt = `sub_upgrade_${companyId}_${plan_id}_${Date.now()}`;

    const order = await razorpay.orders.create({
      amount: amountPaise,
      currency: "INR",
      receipt,
      notes: {
        company_id: String(companyId),
        plan_id: String(plan_id),
      },
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
          price: Number(plan.monthly_price ?? plan.price ?? 0),
          billing_cycle: "mixed",
          display_price: pricing.total_amount,
          users_count: pricing.total_users,
          monthly_users: pricing.monthly_users,
          yearly_users: pricing.yearly_users,
        },
        key_id: process.env.RAZORPAY_KEY_ID,
      },
    });
  } catch (error) {
    console.error("Error creating Razorpay upgrade order:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create payment order",
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
        message: "Razorpay is not configured on server",
      });
    }

    // Determine company context: prefer req.user.company_id, allow superadmin to specify company_id in body
    let companyId =
      req.user && req.user.company_id ? req.user.company_id : null;
    if (
      !companyId &&
      req.user &&
      req.user.role === "superadmin" &&
      req.body.company_id
    ) {
      companyId = req.body.company_id;
    }

    if (!companyId) {
      await trx.rollback();
      return res.status(400).json({
        success: false,
        message:
          "Company context not found. Ensure you are using a company admin account or pass `company_id` in the request body as a superadmin.",
      });
    }
    const {
      plan_id,
      users_count,
      billing_cycle,
      monthly_users,
      yearly_users,
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = req.body;

    if (
      !plan_id ||
      !razorpay_order_id ||
      !razorpay_payment_id ||
      !razorpay_signature
    ) {
      await trx.rollback();
      return res.status(400).json({
        success: false,
        message: "Missing required payment verification fields",
      });
    }

    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      await trx.rollback();
      return res.status(400).json({
        success: false,
        message: "Payment verification failed",
      });
    }

    const plan = await trx("subscription_plans").where("id", plan_id).first();

    if (!plan) {
      await trx.rollback();
      return res.status(404).json({
        success: false,
        message: "Subscription plan not found",
      });
    }

    const pricing = computeSeatMixPricing(plan, {
      users_count,
      billing_cycle,
      monthly_users,
      yearly_users,
    });
    if (pricing.total_users <= 0) {
      await trx.rollback();
      return res.status(400).json({ success: false, message: "Select at least one monthly or yearly user" });
    }
    const paidAmount = pricing.total_payable;

    const startDate = moment().toDate();
    const purchasedPools = [];
    for (const pool of [
      { cycle: "monthly", users: pricing.monthly_users, amount: pricing.monthly_amount },
      { cycle: "yearly", users: pricing.yearly_users, amount: pricing.yearly_amount },
    ]) {
      if (pool.users <= 0) continue;
      const endDate = getEndDateForPlan(startDate, pool.cycle);
      const existing = await trx("company_subscriptions")
        .where({ company_id: companyId, billing_cycle: pool.cycle })
        .orderBy("created_at", "desc")
        .first();
      const values = {
        plan_id,
        start_date: startDate,
        end_date: endDate,
        status: "active",
        max_users: pool.users,
        storage_gb: plan.storage_gb || 1,
        billing_cycle: pool.cycle,
        paid_amount: pool.amount,
        last_payment_date: new Date(),
        next_billing_date: endDate,
        payment_details: JSON.stringify({ provider: "razorpay", razorpay_order_id, razorpay_payment_id }),
        updated_at: new Date(),
      };
      let id;
      if (existing) {
        await trx("company_subscriptions").where("id", existing.id).update(values);
        id = existing.id;
      } else {
        const inserted = await trx("company_subscriptions").insert({ company_id: companyId, ...values });
        id = inserted[0];
      }
      purchasedPools.push({ id, billing_cycle: pool.cycle, users: pool.users, end_date: endDate });
    }
    const subscriptionId = purchasedPools[0].id;
    const endDate = purchasedPools[purchasedPools.length - 1].end_date;

    await trx("subscription_payments").insert({
      company_id: companyId,
      subscription_id: subscriptionId,
      amount: paidAmount,
      payment_method: "upi",
      transaction_id: razorpay_payment_id,
      payment_reference: razorpay_order_id,
      status: "completed",
      payment_date: new Date(),
      notes: JSON.stringify({ provider: "razorpay", razorpay_signature, seat_pools: purchasedPools }),
    });

    await trx.commit();

    return res.json({
      success: true,
      message: "Payment verified and subscription upgraded successfully",
      data: {
        subscription_id: subscriptionId,
        plan_name: plan.name,
        amount_paid: paidAmount,
        next_billing_date: endDate,
        seat_pools: purchasedPools,
      },
    });
  } catch (error) {
    console.error("Error verifying upgrade payment:", error);
    try {
      await trx.rollback();
    } catch (e) {}
    return res.status(500).json({
      success: false,
      message: "Failed to verify payment and upgrade subscription",
    });
  }
};

// Get all plans (including inactive) - for admin
const getAllPlans = async (req, res) => {
  try {
    const planColumns = await getPlanSchemaInfo();
    const monthlyPriceField = getPlanMonthlyPriceField(planColumns);
    const yearlyPriceField = getPlanYearlyPriceField(planColumns);
    const storageField = getPlanStorageField(planColumns);
    const maxUsersField = getPlanMaxUsersField(planColumns);

    let query = db("subscription_plans")
      .orderBy(monthlyPriceField, "asc")
      .select(
        "id",
        "name",
        "description",
        `${monthlyPriceField} as price`,
        yearlyPriceField
          ? `${yearlyPriceField} as yearly_price`
          : db.raw("NULL as yearly_price"),
        maxUsersField
          ? `${maxUsersField} as max_users`
          : db.raw("0 as max_users"),
        storageField
          ? `${storageField} as storage_gb`
          : db.raw("NULL as storage_gb"),
        "trial_days",
        "is_active",
        "created_at",
        "updated_at",
      );

    const plans = await query;

    res.json({
      success: true,
      data: plans,
    });
  } catch (error) {
    console.error("Error fetching all subscription plans:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch subscription plans",
    });
  }
};

// Create new subscription plan
const createPlan = async (req, res) => {
  try {
    console.log("Create plan request received:", req.body);

    const {
      name,
      description,
      price,
      yearly_price,
      storage_gb,
      trial_days,
      is_active = true,
    } = req.body;

    if (!String(name || "").trim()) {
      return res.status(400).json({
        success: false,
        message: "Plan name is required",
      });
    }

    const resolvedPricing = resolvePlanPricingFields(name, {
      price,
      yearly_price,
      trial_days,
    });
    const isFreePlan = isFreePlanName(name);

    if (
      !isFreePlan &&
      (resolvedPricing.price === undefined ||
        resolvedPricing.yearly_price === undefined ||
        resolvedPricing.trial_days === undefined)
    ) {
      console.log("Validation failed - missing fields");
      return res.status(400).json({
        success: false,
        message:
          "Missing required fields: name, price, yearly_price, trial_days",
      });
    }

    // Check if storage_gb column exists before trying to insert it
    const hasStorageColumn = await checkStorageColumnExists();

    const planColumns = await getPlanSchemaInfo();
    const monthlyPriceField = getPlanMonthlyPriceField(planColumns);
    const yearlyPriceField = getPlanYearlyPriceField(planColumns);

    console.log("Creating plan with data:", {
      name,
      description,
      price: resolvedPricing.price,
      yearly_price: resolvedPricing.yearly_price,
      storage_gb,
      trial_days: resolvedPricing.trial_days,
      is_active,
    });

    const planData = {
      name: String(name).trim(),
      description,
      trial_days: resolvedPricing.trial_days,
      is_active,
    };

    planData[monthlyPriceField] = resolvedPricing.price;
    if (yearlyPriceField) {
      planData[yearlyPriceField] = resolvedPricing.yearly_price;
    }

    if (hasStorageColumn) {
      planData.storage_gb = resolvePlanStorageGb(name, storage_gb);
    }

    const maxUsersField = getPlanMaxUsersField(planColumns);
    if (maxUsersField && planData[maxUsersField] === undefined) {
      planData[maxUsersField] = isFreePlan
        ? 0
        : (parseOptionalNumber(req.body.max_users) ?? 25);
    }

    const [planId] = await db("subscription_plans").insert(planData);

    console.log("Plan created successfully with ID:", planId);

    res.status(201).json({
      success: true,
      message: "Subscription plan created successfully",
      data: { id: planId },
    });
  } catch (error) {
    console.error("Error creating subscription plan:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create subscription plan",
    });
  }
};

// Helper function to check if storage_gb column exists
const checkStorageColumnExists = async () => {
  try {
    const column = await db("subscription_plans")
      .columnInfo()
      .then((columns) => columns.storage_gb);
    return !!column;
  } catch (error) {
    console.log("Could not check storage_gb column:", error.message);
    return false;
  }
};

// Update subscription plan
const updatePlan = async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Update plan request received:", req.body);
    const {
      name,
      description,
      price,
      yearly_price,
      storage_gb,
      trial_days,
      is_active,
    } = req.body;

    // Check if plan exists
    const existingPlan = await db("subscription_plans").where("id", id).first();
    if (!existingPlan) {
      return res.status(404).json({
        success: false,
        message: "Subscription plan not found",
      });
    }

    const planColumns = await getPlanSchemaInfo();
    const monthlyPriceField = getPlanMonthlyPriceField(planColumns);
    const yearlyPriceField = getPlanYearlyPriceField(planColumns);
    const hasStorageColumn = await checkStorageColumnExists();

    const planName = String(name || existingPlan.name || "").trim();
    const resolvedPricing = resolvePlanPricingFields(planName, {
      price,
      yearly_price,
      trial_days,
    });
    const isFreePlan = isFreePlanName(planName);

    const resolvedPrice = isFreePlan
      ? 0
      : price !== undefined
        ? price
        : (existingPlan[monthlyPriceField] ?? existingPlan.price);

    const resolvedYearlyPrice = isFreePlan
      ? 0
      : yearly_price !== undefined
        ? yearly_price
        : yearlyPriceField
          ? existingPlan[yearlyPriceField]
          : undefined;

    const resolvedTrialDays = isFreePlan
      ? 0
      : trial_days !== undefined && trial_days !== null
        ? trial_days
        : existingPlan.trial_days;

    const updateData = {
      name: planName,
      description,
      trial_days: resolvedTrialDays,
      is_active,
      updated_at: new Date(),
    };

    updateData[monthlyPriceField] = resolvedPrice;
    if (yearlyPriceField && resolvedYearlyPrice !== undefined) {
      updateData[yearlyPriceField] = resolvedYearlyPrice;
    }

    if (hasStorageColumn) {
      updateData.storage_gb =
        storage_gb !== undefined
          ? resolvePlanStorageGb(planName, storage_gb)
          : resolvePlanStorageGb(planName, existingPlan.storage_gb);
    }

    const maxUsersField = getPlanMaxUsersField(planColumns);
    if (maxUsersField && req.body.max_users !== undefined) {
      updateData[maxUsersField] =
        parseOptionalNumber(req.body.max_users) ?? existingPlan[maxUsersField];
    }

    await db("subscription_plans").where("id", id).update(updateData);

    res.json({
      success: true,
      message: "Subscription plan updated successfully",
    });
  } catch (error) {
    console.error("Error updating subscription plan:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update subscription plan",
    });
  }
};

// Patch subscription plan (for specific updates like status)
const patchPlan = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    // Check if plan exists
    const existingPlan = await db("subscription_plans").where("id", id).first();
    if (!existingPlan) {
      return res.status(404).json({
        success: false,
        message: "Subscription plan not found",
      });
    }

    // Check if storage_gb column exists and is being updated
    const hasStorageColumn = await checkStorageColumnExists();
    const finalUpdateData = { ...updateData, updated_at: new Date() };

    // Remove storage_gb if column doesn't exist
    if (!hasStorageColumn && finalUpdateData.storage_gb !== undefined) {
      delete finalUpdateData.storage_gb;
    }

    await db("subscription_plans").where("id", id).update(finalUpdateData);

    res.json({
      success: true,
      message: "Subscription plan updated successfully",
    });
  } catch (error) {
    console.error("Error updating subscription plan:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update subscription plan",
    });
  }
};

// Delete subscription plan
const deletePlan = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if plan exists
    const existingPlan = await db("subscription_plans").where("id", id).first();
    if (!existingPlan) {
      return res.status(404).json({
        success: false,
        message: "Subscription plan not found",
      });
    }

    // If the plan is still in use, deactivate it instead of hard-deleting it.
    const activeSubscription = await db("company_subscriptions")
      .where("plan_id", id)
      .whereIn("status", ["trial", "active"])
      .first();

    if (activeSubscription) {
      await db("subscription_plans").where("id", id).update({
        is_active: false,
        updated_at: new Date(),
      });

      return res.json({
        success: true,
        message:
          "Plan is being used by active subscriptions, so it was deactivated instead of deleted.",
        deactivated: true,
      });
    }

    await db("subscription_plans").where("id", id).del();

    res.json({
      success: true,
      message: "Subscription plan deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting subscription plan:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete subscription plan",
    });
  }
};

// Get all subscriptions (for superadmin)
const getAllSubscriptions = async (req, res) => {
  try {
    const planColumns = await getPlanSchemaInfo();
    const monthlyPriceField = getPlanMonthlyPriceField(planColumns);

    const subscriptions = await db("company_subscriptions")
      .select(
        "company_subscriptions.*",
        "subscription_plans.name as plan_name",
        `${monthlyPriceField} as plan_price`,
        "company_subscriptions.max_users as plan_max_users",
        "companies.company_name",
      )
      .join(
        "subscription_plans",
        "company_subscriptions.plan_id",
        "subscription_plans.id",
      )
      .join("companies", "company_subscriptions.company_id", "companies.id")
      .orderBy("company_subscriptions.created_at", "desc");

    res.json({
      success: true,
      data: subscriptions,
    });
  } catch (error) {
    console.error("Error fetching all subscriptions:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch subscriptions",
    });
  }
};

const getAddons = async (req, res) => {
  try {
    const hasAddons = await db.schema.hasTable("subscription_addons");
    if (!hasAddons) {
      return res.json({ success: true, data: [] });
    }

    const addonColumns = await db("subscription_addons").columnInfo();
    const moduleKeySelect = addonColumns.module_key
      ? "module_key"
      : db.raw("NULL as module_key");

    const addons = await db("subscription_addons")
      .select(
        "id",
        "name",
        "description",
        moduleKeySelect,
        "price_upto25",
        "price_upto50",
        "price_above50",
        "is_active",
        "created_at",
        "updated_at",
      )
      .orderBy("created_at", "desc");

    res.json({
      success: true,
      data: addons.map((addon) => ({
        ...addon,
        module_key: inferAddonModuleKey(addon),
        price_upto5: Number(addon.price_upto25 || 0),
        price_upto10: Number(addon.price_upto50 || 0),
        price_upto15: Number(addon.price_above50 || 0),
        price_upto25: Number(addon.price_upto25 || 0),
        price_upto50: Number(addon.price_upto50 || 0),
        price_above50: Number(addon.price_above50 || 0),
      })),
    });
  } catch (error) {
    console.error("Error fetching subscription add-ons:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch subscription add-ons",
    });
  }
};

const getAvailableAddons = async (req, res) => {
  try {
    const hasAddons = await db.schema.hasTable("subscription_addons");
    if (!hasAddons) {
      return res.json({ success: true, data: [] });
    }

    const addonColumns = await db("subscription_addons").columnInfo();
    const moduleKeySelect = addonColumns.module_key
      ? "module_key"
      : db.raw("NULL as module_key");

    const addons = await db("subscription_addons")
      .where("is_active", true)
      .select(
        "id",
        "name",
        "description",
        moduleKeySelect,
        "price_upto25",
        "price_upto50",
        "price_above50",
        "is_active",
      )
      .orderBy("name", "asc");

    res.json({
      success: true,
      data: addons.map((addon) => ({
        ...addon,
        module_key: inferAddonModuleKey(addon),
        price_upto5: Number(addon.price_upto25 || 0),
        price_upto10: Number(addon.price_upto50 || 0),
        price_upto15: Number(addon.price_above50 || 0),
        price_upto25: Number(addon.price_upto25 || 0),
        price_upto50: Number(addon.price_upto50 || 0),
        price_above50: Number(addon.price_above50 || 0),
      })),
    });
  } catch (error) {
    console.error("Error fetching available add-ons:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch available add-ons",
    });
  }
};

const createAddon = async (req, res) => {
  try {
    const { name, description, module_key, is_active = true } = req.body;

    const priceUpto5 = req.body.price_upto5 ?? req.body.price_upto25;
    const priceUpto10 = req.body.price_upto10 ?? req.body.price_upto50;
    const priceUpto15 =
      req.body.price_upto15 ?? req.body.price_above15 ?? req.body.price_above50;

    if (
      !name ||
      !module_key ||
      priceUpto5 === undefined ||
      priceUpto10 === undefined ||
      priceUpto15 === undefined
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Missing required fields: name, module_key, price_upto5, price_upto10, price_upto15",
      });
    }

    const addonColumns = await db("subscription_addons").columnInfo();
    const addonData = {
      name,
      description,
      price_upto25: Number(priceUpto5),
      price_upto50: Number(priceUpto10),
      price_above50: Number(priceUpto15),
      is_active,
      created_at: new Date(),
      updated_at: new Date(),
    };

    if (addonColumns.module_key) {
      addonData.module_key = normalizeModuleKey(module_key);
    }

    const [addonId] = await db("subscription_addons").insert(addonData);

    res.status(201).json({
      success: true,
      message: "Add-on package created successfully",
      data: { id: addonId },
    });
  } catch (error) {
    console.error("Error creating subscription add-on:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create add-on package",
    });
  }
};

const updateAddon = async (req, res) => {
  try {
    const { id } = req.params;
    const existingAddon = await db("subscription_addons")
      .where("id", id)
      .first();
    if (!existingAddon) {
      return res.status(404).json({
        success: false,
        message: "Add-on package not found",
      });
    }

    const addonColumns = await db("subscription_addons").columnInfo();
    const priceUpto5 = req.body.price_upto5 ?? req.body.price_upto25;
    const priceUpto10 = req.body.price_upto10 ?? req.body.price_upto50;
    const priceUpto15 =
      req.body.price_upto15 ?? req.body.price_above15 ?? req.body.price_above50;

    if (
      priceUpto5 === undefined ||
      priceUpto10 === undefined ||
      priceUpto15 === undefined
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Missing required fields: price_upto5, price_upto10, price_upto15",
      });
    }

    const updateData = {
      name: req.body.name,
      description: req.body.description,
      price_upto25: Number(priceUpto5),
      price_upto50: Number(priceUpto10),
      price_above50: Number(priceUpto15),
      is_active: Boolean(req.body.is_active),
      updated_at: new Date(),
    };

    if (addonColumns.module_key) {
      updateData.module_key = normalizeModuleKey(req.body.module_key);
    }

    await db("subscription_addons").where("id", id).update(updateData);

    res.json({
      success: true,
      message: "Add-on package updated successfully",
    });
  } catch (error) {
    console.error("Error updating subscription add-on:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update add-on package",
    });
  }
};

const deleteAddon = async (req, res) => {
  try {
    const { id } = req.params;
    const existingAddon = await db("subscription_addons")
      .where("id", id)
      .first();
    if (!existingAddon) {
      return res.status(404).json({
        success: false,
        message: "Add-on package not found",
      });
    }

    const activeAssignment = await db("company_subscription_addons")
      .where("addon_id", id)
      .first();

    if (activeAssignment) {
      await db("subscription_addons")
        .where("id", id)
        .update({ is_active: false, updated_at: new Date() });

      return res.json({
        success: true,
        message:
          "Add-on is assigned to a subscription, so it was deactivated instead of deleted.",
        deactivated: true,
      });
    }

    await db("subscription_addons").where("id", id).del();
    res.json({
      success: true,
      message: "Add-on package deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting subscription add-on:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete add-on package",
    });
  }
};

const assignAddonToCompany = async (req, res) => {
  const trx = await db.transaction();

  try {
    const {
      company_id,
      addon_id,
      users_count,
      billing_cycle = "monthly",
    } = req.body;
    const selectedUsers = resolveSelectedUsers(users_count);
    const normalizedCycle = normalizeBillingCycle(billing_cycle);

    if (!company_id || !addon_id) {
      await trx.rollback();
      return res.status(400).json({
        success: false,
        message: "company_id and addon_id are required",
      });
    }

    const company = await trx("companies").where("id", company_id).first();
    if (!company) {
      await trx.rollback();
      return res.status(404).json({
        success: false,
        message: "Organization not found",
      });
    }

    const addon = await trx("subscription_addons")
      .where("id", addon_id)
      .first();
    if (!addon) {
      await trx.rollback();
      return res.status(404).json({
        success: false,
        message: "Add-on package not found",
      });
    }

    const subscription = await trx("company_subscriptions")
      .where("company_id", company_id)
      .whereIn("status", ["trial", "active"])
      .orderBy("created_at", "desc")
      .first();

    if (!subscription) {
      await trx.rollback();
      return res.status(400).json({
        success: false,
        message:
          "Organization needs an active base subscription before assigning add-ons",
      });
    }

    const pricePerUser = getAddonPriceForUsers(addon, selectedUsers);
    const totalPrice = roundMoney(
      pricePerUser * selectedUsers * (normalizedCycle === "yearly" ? 12 : 1),
    );

    const existingAssignment = await trx("company_subscription_addons")
      .where({
        subscription_id: subscription.id,
        addon_id,
      })
      .first();

    if (existingAssignment) {
      await trx("company_subscription_addons")
        .where("id", existingAssignment.id)
        .update({
          users_count: selectedUsers,
          billing_cycle: normalizedCycle,
          price_per_user: pricePerUser,
          total_price: totalPrice,
          updated_at: new Date(),
        });
    } else {
      await trx("company_subscription_addons").insert({
        subscription_id: subscription.id,
        addon_id,
        users_count: selectedUsers,
        billing_cycle: normalizedCycle,
        price_per_user: pricePerUser,
        total_price: totalPrice,
        created_at: new Date(),
        updated_at: new Date(),
      });
    }

    const previousAddonTotal = existingAssignment
      ? Number(existingAssignment.total_price || 0)
      : 0;
    const currentPaidAmount = Number(subscription.paid_amount || 0);
    await trx("company_subscriptions")
      .where("id", subscription.id)
      .update({
        paid_amount: roundMoney(
          currentPaidAmount - previousAddonTotal + totalPrice,
        ),
        updated_at: new Date(),
      });

    await trx.commit();

    res.json({
      success: true,
      message: "Add-on assigned to organization successfully",
      data: {
        subscription_id: subscription.id,
        addon_id,
        users_count: selectedUsers,
        billing_cycle: normalizedCycle,
        price_per_user: pricePerUser,
        total_price: totalPrice,
      },
    });
  } catch (error) {
    console.error("Error assigning subscription add-on:", error);
    try {
      await trx.rollback();
    } catch (e) {}
    res.status(500).json({
      success: false,
      message: "Failed to assign add-on to organization",
    });
  }
};

const createAddonOrder = async (req, res) => {
  try {
    if (!razorpay) {
      return res.status(500).json({
        success: false,
        message:
          "Razorpay is not configured. Please add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to .env file.",
      });
    }

    const companyId =
      req.user && req.user.company_id ? req.user.company_id : null;
    const { addon_id, users_count, billing_cycle } = req.body;

    if (!companyId) {
      return res.status(400).json({
        success: false,
        message: "Company context not found",
      });
    }

    if (!addon_id) {
      return res.status(400).json({
        success: false,
        message: "addon_id is required",
      });
    }

    let subscription = await db("company_subscriptions")
      .where("company_id", companyId)
      .whereIn("status", ["trial", "active"])
      .orderBy("created_at", "desc")
      .first();

    if (!subscription) {
      return res.status(400).json({
        success: false,
        message:
          "Please start or buy a base subscription before buying add-ons",
      });
    }

    const addon = await db("subscription_addons")
      .where({ id: addon_id, is_active: true })
      .first();

    if (!addon) {
      return res.status(404).json({
        success: false,
        message: "Add-on package not found",
      });
    }

    const selectedUsers = resolveSelectedUsers(users_count);
    const normalizedCycle = normalizeBillingCycle(billing_cycle);
    const pricePerUser = getAddonPriceForUsers(addon, selectedUsers);
    const totalPrice = roundMoney(
      pricePerUser * selectedUsers * (normalizedCycle === "yearly" ? 12 : 1),
    );

    const amountPaise = Math.round(totalPrice * 100);
    if (!Number.isFinite(amountPaise) || amountPaise <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid add-on amount",
      });
    }

    const order = await razorpay.orders.create({
      amount: amountPaise,
      currency: "INR",
      receipt: `sub_addon_${companyId}_${addon_id}_${Date.now()}`,
      notes: {
        company_id: String(companyId),
        subscription_id: String(subscription.id),
        addon_id: String(addon_id),
      },
    });

    return res.json({
      success: true,
      data: {
        order_id: order.id,
        amount: order.amount,
        currency: order.currency,
        key_id: process.env.RAZORPAY_KEY_ID,
        addon: {
          id: addon.id,
          name: addon.name,
          module_key: inferAddonModuleKey(addon),
          users_count: selectedUsers,
          billing_cycle: normalizedCycle,
          price_per_user: pricePerUser,
          total_price: totalPrice,
        },
      },
    });
  } catch (error) {
    console.error("Error creating add-on order:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create add-on payment order",
    });
  }
};

const verifyAddonPayment = async (req, res) => {
  const trx = await db.transaction();

  try {
    if (!razorpay) {
      await trx.rollback();
      return res.status(500).json({
        success: false,
        message: "Razorpay is not configured on server",
      });
    }

    const companyId =
      req.user && req.user.company_id ? req.user.company_id : null;
    const {
      addon_id,
      users_count,
      billing_cycle,
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = req.body;

    if (!companyId) {
      await trx.rollback();
      return res
        .status(400)
        .json({ success: false, message: "Company context not found" });
    }

    if (
      !addon_id ||
      !razorpay_order_id ||
      !razorpay_payment_id ||
      !razorpay_signature
    ) {
      await trx.rollback();
      return res.status(400).json({
        success: false,
        message: "Missing required payment verification fields",
      });
    }

    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      await trx.rollback();
      return res.status(400).json({
        success: false,
        message: "Payment verification failed",
      });
    }

    const subscription = await trx("company_subscriptions")
      .where("company_id", companyId)
      .whereIn("status", ["trial", "active"])
      .orderBy("created_at", "desc")
      .first();

    if (!subscription) {
      await trx.rollback();
      return res.status(400).json({
        success: false,
        message: "Active subscription not found",
      });
    }

    const addon = await trx("subscription_addons")
      .where({ id: addon_id, is_active: true })
      .first();

    if (!addon) {
      await trx.rollback();
      return res.status(404).json({
        success: false,
        message: "Add-on package not found",
      });
    }

    const selectedUsers = resolveSelectedUsers(users_count);
    const normalizedCycle = normalizeBillingCycle(billing_cycle);
    const pricePerUser = getAddonPriceForUsers(addon, selectedUsers);
    const totalPrice = roundMoney(
      pricePerUser * selectedUsers * (normalizedCycle === "yearly" ? 12 : 1),
    );

    const existingAssignment = await trx("company_subscription_addons")
      .where({
        subscription_id: subscription.id,
        addon_id,
      })
      .first();

    if (existingAssignment) {
      await trx("company_subscription_addons")
        .where("id", existingAssignment.id)
        .update({
          users_count: selectedUsers,
          billing_cycle: normalizedCycle,
          price_per_user: pricePerUser,
          total_price: totalPrice,
          updated_at: new Date(),
        });
    } else {
      await trx("company_subscription_addons").insert({
        subscription_id: subscription.id,
        addon_id,
        users_count: selectedUsers,
        billing_cycle: normalizedCycle,
        price_per_user: pricePerUser,
        total_price: totalPrice,
        created_at: new Date(),
        updated_at: new Date(),
      });
    }

    const previousAddonTotal = existingAssignment
      ? Number(existingAssignment.total_price || 0)
      : 0;
    await trx("company_subscriptions")
      .where("id", subscription.id)
      .update({
        paid_amount: roundMoney(
          Number(subscription.paid_amount || 0) -
            previousAddonTotal +
            totalPrice,
        ),
        last_payment_date: new Date(),
        payment_details: JSON.stringify({
          provider: "razorpay",
          razorpay_order_id,
          razorpay_payment_id,
          purchase_type: "addon",
        }),
        updated_at: new Date(),
      });

    await trx("subscription_payments").insert({
      company_id: companyId,
      subscription_id: subscription.id,
      amount: totalPrice,
      payment_method: "upi",
      transaction_id: razorpay_payment_id,
      payment_reference: razorpay_order_id,
      status: "completed",
      payment_date: new Date(),
      notes: JSON.stringify({
        provider: "razorpay",
        purchase_type: "addon",
        addon_id,
        addon_name: addon.name,
        users_count: selectedUsers,
        razorpay_signature,
      }),
    });

    await trx.commit();

    return res.json({
      success: true,
      message: "Add-on purchased successfully",
      data: {
        addon_id,
        addon_name: addon.name,
        users_count: selectedUsers,
        amount_paid: totalPrice,
      },
    });
  } catch (error) {
    console.error("Error verifying add-on payment:", error);
    try {
      await trx.rollback();
    } catch (e) {}
    return res.status(500).json({
      success: false,
      message: "Failed to verify add-on payment",
    });
  }
};

const removeCompanyAddon = async (req, res) => {
  try {
    const { assignmentId } = req.params;
    const existingAssignment = await db("company_subscription_addons")
      .where("id", assignmentId)
      .first();

    if (!existingAssignment) {
      return res.status(404).json({
        success: false,
        message: "Assigned add-on not found",
      });
    }

    await db("company_subscription_addons").where("id", assignmentId).del();

    res.json({
      success: true,
      message: "Add-on removed from organization successfully",
    });
  } catch (error) {
    console.error("Error removing company add-on:", error);
    res.status(500).json({
      success: false,
      message: "Failed to remove add-on from organization",
    });
  }
};

const getAddonUserAssignments = async (req, res) => {
  try {
    const companyId =
      req.user && req.user.company_id ? req.user.company_id : null;
    if (!companyId) {
      return res.status(400).json({
        success: false,
        message: "Company context not found",
      });
    }

    let subscription = await db("company_subscriptions")
      .where("company_id", companyId)
      .whereIn("status", ["trial", "active"])
      .orderBy("created_at", "desc")
      .first();

    if (!subscription) {
      return res.json({ success: true, data: [] });
    }

    const activeAddons = await getSubscriptionAddons(subscription.id);
    const hasAssignments = await db.schema.hasTable(
      "company_addon_user_assignments",
    );
    if (!hasAssignments) {
      return res.json({
        success: true,
        data: activeAddons.map((addon) => ({
          ...addon,
          assignments: [],
        })),
      });
    }

    const assignments = await db("company_addon_user_assignments")
      .leftJoin(
        "employees",
        "company_addon_user_assignments.employee_id",
        "employees.id",
      )
      .where("company_addon_user_assignments.company_id", companyId)
      .select(
        "company_addon_user_assignments.id",
        "company_addon_user_assignments.subscription_addon_id",
        "company_addon_user_assignments.addon_id",
        "company_addon_user_assignments.employee_id",
        "company_addon_user_assignments.module_key",
        "employees.first_name",
        "employees.last_name",
        "employees.employee_id as employee_code",
        "employees.email",
      );

    const data = activeAddons.map((addon) => ({
      ...addon,
      assignments: assignments
        .filter(
          (assignment) =>
            Number(assignment.subscription_addon_id) === Number(addon.id),
        )
        .map((assignment) => ({
          id: assignment.id,
          employee_id: assignment.employee_id,
          employee_code: assignment.employee_code,
          name: `${assignment.first_name || ""} ${assignment.last_name || ""}`.trim(),
          email: assignment.email,
          module_key: assignment.module_key,
        })),
    }));

    return res.json({ success: true, data });
  } catch (error) {
    console.error("Error fetching add-on user assignments:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch add-on user assignments",
    });
  }
};

const updateAddonUserAssignments = async (req, res) => {
  const trx = await db.transaction();

  try {
    const companyId =
      req.user && req.user.company_id ? req.user.company_id : null;
    const { subscriptionAddonId } = req.params;
    const employeeIds = Array.isArray(req.body.employee_ids)
      ? req.body.employee_ids.map((id) => Number(id)).filter(Boolean)
      : [];

    if (!companyId) {
      await trx.rollback();
      return res
        .status(400)
        .json({ success: false, message: "Company context not found" });
    }

    const subscription = await trx("company_subscriptions")
      .where("company_id", companyId)
      .whereIn("status", ["trial", "active"])
      .orderBy("created_at", "desc")
      .first();

    if (!subscription) {
      await trx.rollback();
      return res
        .status(400)
        .json({ success: false, message: "Active subscription not found" });
    }

    const subscriptionAddon = await trx("company_subscription_addons")
      .join(
        "subscription_addons",
        "company_subscription_addons.addon_id",
        "subscription_addons.id",
      )
      .where("company_subscription_addons.id", subscriptionAddonId)
      .where("company_subscription_addons.subscription_id", subscription.id)
      .select(
        "company_subscription_addons.id",
        "company_subscription_addons.addon_id",
        "company_subscription_addons.users_count",
        "subscription_addons.name",
        "subscription_addons.description",
        "subscription_addons.module_key",
      )
      .first();

    if (!subscriptionAddon) {
      await trx.rollback();
      return res
        .status(404)
        .json({ success: false, message: "Add-on subscription not found" });
    }

    const seatLimit = Number(subscriptionAddon.users_count || 0);
    if (employeeIds.length > seatLimit) {
      await trx.rollback();
      return res.status(400).json({
        success: false,
        message: `This add-on allows only ${seatLimit} assigned users`,
      });
    }

    if (employeeIds.length > 0) {
      const employeeCount = await trx("employees")
        .where("company_id", companyId)
        .whereIn("id", employeeIds)
        .count("* as count")
        .first();

      if ((parseInt(employeeCount.count, 10) || 0) !== employeeIds.length) {
        await trx.rollback();
        return res.status(400).json({
          success: false,
          message: "One or more selected employees are invalid",
        });
      }
    }

    const moduleKeys = [...getAddonModuleAliases(subscriptionAddon)];
    const primaryModuleKey = moduleKeys.includes("live_tracking")
      ? "live_tracking"
      : normalizeAddonModuleKey(
          subscriptionAddon.module_key ||
            moduleKeys[0] ||
            subscriptionAddon.name,
        );

    await trx("company_addon_user_assignments")
      .where({
        company_id: companyId,
        subscription_addon_id: subscriptionAddon.id,
      })
      .del();

    if (employeeIds.length > 0) {
      await trx("company_addon_user_assignments").insert(
        employeeIds.map((employeeId) => ({
          company_id: companyId,
          subscription_addon_id: subscriptionAddon.id,
          addon_id: subscriptionAddon.addon_id,
          employee_id: employeeId,
          module_key: primaryModuleKey,
          created_at: new Date(),
          updated_at: new Date(),
        })),
      );
    }

    if (moduleKeys.includes("live_tracking")) {
      await trx("employees")
        .where("company_id", companyId)
        .update({ location_tracking_enabled: 0 });

      if (employeeIds.length > 0) {
        await trx("employees")
          .where("company_id", companyId)
          .whereIn("id", employeeIds)
          .update({ location_tracking_enabled: 1 });
      }
    }

    await trx.commit();

    return res.json({
      success: true,
      message: "Add-on users updated successfully",
      data: {
        subscription_addon_id: Number(subscriptionAddon.id),
        assigned_users: employeeIds.length,
        max_users: seatLimit,
      },
    });
  } catch (error) {
    console.error("Error updating add-on user assignments:", error);
    try {
      await trx.rollback();
    } catch (e) {}
    return res.status(500).json({
      success: false,
      message: "Failed to update add-on users",
    });
  }
};

// Get company's current subscription
const getCompanySubscription = async (req, res) => {
  try {
    const companyId = req.user.company_id;
    const { getInternalFullAccessCompany } = require("../utils/internalCompany");
    const planColumns = await getPlanSchemaInfo();
    const monthlyPriceField = getPlanMonthlyPriceField(planColumns);
    const storageField = getPlanStorageField(planColumns);

    if (!companyId) {
      return res.status(400).json({
        success: false,
        message: "Company context not found for current user",
      });
    }

    const internalCompany = await getInternalFullAccessCompany(companyId, db);

    const subscription = await db("company_subscriptions")
      .select(
        "company_subscriptions.*",
        "subscription_plans.name as plan_name",
        "subscription_plans.description as plan_description",
        `${monthlyPriceField} as plan_price`,
        "company_subscriptions.max_users as plan_max_users",
        storageField
          ? `subscription_plans.${storageField} as plan_storage_gb`
          : db.raw("NULL as plan_storage_gb"),
      )
      .join(
        "subscription_plans",
        "company_subscriptions.plan_id",
        "subscription_plans.id",
      )
      .where("company_subscriptions.company_id", companyId)
      .orderBy("company_subscriptions.created_at", "desc")
      .first();

    const activeSeatPools = await db("company_subscriptions")
      .where("company_id", companyId)
      .where(function () {
        this.where(function () {
          this.where("status", "active").where("end_date", ">=", db.fn.now());
        }).orWhere(function () {
          this.where("status", "trial").where(
            "trial_end_date",
            ">=",
            db.fn.now(),
          );
        });
      })
      .orderBy("created_at", "desc");

    const allSeatPools = await db("company_subscriptions")
      .where("company_id", companyId)
      .orderBy("created_at", "desc");
    const latestPoolByCycle = new Map();
    allSeatPools.forEach((pool) => {
      const cycle = normalizeBillingCycle(pool.billing_cycle);
      if (!latestPoolByCycle.has(cycle)) latestPoolByCycle.set(cycle, pool);
    });

    if (activeSeatPools.length > 0) {
      const activePrimary = activeSeatPools.find(
        (pool) => Number(pool.id) === Number(subscription?.id),
      );
      if (!activePrimary) {
        const primaryId = activeSeatPools[0].id;
        subscription = await db("company_subscriptions")
          .select(
            "company_subscriptions.*",
            "subscription_plans.name as plan_name",
            "subscription_plans.description as plan_description",
            `${monthlyPriceField} as plan_price`,
            "company_subscriptions.max_users as plan_max_users",
            storageField
              ? `subscription_plans.${storageField} as plan_storage_gb`
              : db.raw("NULL as plan_storage_gb"),
          )
          .join(
            "subscription_plans",
            "company_subscriptions.plan_id",
            "subscription_plans.id",
          )
          .where("company_subscriptions.id", primaryId)
          .first();
      }
    }

    if (!subscription) {
      return res.json({
        success: true,
        data: internalCompany
          ? {
              status: "active",
              plan_name: "Internal full access",
              plan_description: "All modules",
              is_internal_company: true,
              addons: [],
            }
          : null,
        message: internalCompany
          ? "Internal company has full module access"
          : "No active subscription found",
      });
    }

    const today = moment();
    const isTrialSubscription =
      subscription.status === "trial" && !!subscription.trial_end_date;
    const trialEndMoment = subscription.trial_end_date
      ? moment(subscription.trial_end_date)
      : null;
    const regularEndMoment = subscription.end_date
      ? moment(subscription.end_date)
      : null;

    const isTrialActive =
      isTrialSubscription &&
      trialEndMoment &&
      moment().startOf("day").isBefore(trialEndMoment.clone().startOf("day"));

    const effectiveEndMoment =
      isTrialSubscription && trialEndMoment ? trialEndMoment : regularEndMoment;

    const daysRemaining = effectiveEndMoment
      ? effectiveEndMoment.diff(today, "days")
      : 0;

    const assignedByCycleRows = await db("employees")
      .where("company_id", companyId)
      .select("subscription_billing_cycle")
      .count("* as assigned_users")
      .groupBy("subscription_billing_cycle");
    const assignedByCycle = Object.fromEntries(
      assignedByCycleRows.map((row) => [
        row.subscription_billing_cycle || "monthly",
        Number(row.assigned_users || 0),
      ]),
    );
    const seatPools = activeSeatPools.map((pool) => ({
      id: Number(pool.id),
      billing_cycle: normalizeBillingCycle(pool.billing_cycle),
      max_users: Number(pool.max_users || 0),
      assigned_users:
        assignedByCycle[normalizeBillingCycle(pool.billing_cycle)] || 0,
      available_users: Math.max(
        0,
        Number(pool.max_users || 0) -
          (assignedByCycle[normalizeBillingCycle(pool.billing_cycle)] || 0),
      ),
      end_date: pool.end_date,
      status: pool.status,
    }));
    const seatPoolStatus = Array.from(latestPoolByCycle.values()).map((pool) => {
      const cycle = normalizeBillingCycle(pool.billing_cycle);
      const effectiveEndDate = pool.status === "trial"
        ? pool.trial_end_date
        : pool.end_date;
      const isActive =
        ["active", "trial"].includes(String(pool.status)) &&
        effectiveEndDate &&
        moment(effectiveEndDate).isSameOrAfter(moment());
      return {
        id: Number(pool.id),
        plan_id: Number(pool.plan_id),
        billing_cycle: cycle,
        max_users: Number(pool.max_users || 0),
        assigned_users: assignedByCycle[cycle] || 0,
        end_date: effectiveEndDate,
        status: isActive ? "active" : "expired",
        is_active: Boolean(isActive),
      };
    });
    const totalMaxUsers = seatPools.reduce(
      (sum, pool) => sum + pool.max_users,
      0,
    );

    res.json({
      success: true,
      data: {
        ...subscription,
        max_users: totalMaxUsers || Number(subscription.max_users || 0),
        plan_max_users: totalMaxUsers || Number(subscription.max_users || 0),
        seat_pools: seatPools,
        seat_pool_status: seatPoolStatus,
        is_free_plan: Number(subscription.plan_price || 0) === 0,
        is_internal_company: Boolean(internalCompany),
        addons: await getSubscriptionAddons(subscription.id),
        days_remaining: Math.max(0, daysRemaining),
        is_trial_active: isTrialActive,
        trial_days_remaining: trialEndMoment
          ? Math.max(0, trialEndMoment.diff(today, "days"))
          : 0,
        storage_usage_percentage:
          subscription.storage_gb > 0
            ? Math.round(
                ((subscription.used_storage_mb || 0) /
                  (subscription.storage_gb * 1024)) *
                  100,
              )
            : 0,
      },
    });
  } catch (error) {
    console.error("Error fetching company subscription:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch subscription details",
    });
  }
};

// Start free trial
const startTrial = async (req, res) => {
  try {
    const { plan_id, users_count, billing_cycle } = req.body;
    const companyId = req.user.company_id;

    // Check if company already has an active trial or subscription
    const existingSubscription = await db("company_subscriptions")
      .where("company_id", companyId)
      .whereIn("status", ["trial", "active"])
      .where(function () {
        this.where("end_date", ">=", db.fn.now()).orWhere(
          "trial_end_date",
          ">=",
          db.fn.now(),
        );
      })
      .first();

    if (existingSubscription) {
      return res.status(400).json({
        success: false,
        message: "Company already has an active subscription or trial",
      });
    }

    // Get plan details
    const plan = await db("subscription_plans").where("id", plan_id).first();

    if (!plan) {
      return res.status(404).json({
        success: false,
        message: "Subscription plan not found",
      });
    }

    const selectedUsers = resolveSelectedUsers(users_count);
    const pricing = computePricing(plan, selectedUsers, billing_cycle);

    const startDate = moment().toDate();
    const isFreePlan =
      Number(pricing.price_per_user || 0) === 0 &&
      Number(pricing.total_amount || 0) === 0;

    if (isFreePlan) {
      const endDate = moment(startDate).add(100, "years").toDate();
      const existingFreePool = await db("company_subscriptions")
        .where({ company_id: companyId, billing_cycle: pricing.billing_cycle })
        .orderBy("created_at", "desc")
        .first();
      const values = {
        plan_id,
        start_date: startDate,
        end_date: endDate,
        trial_end_date: null,
        status: "active",
        max_users: selectedUsers,
        storage_gb: plan.storage_gb || 1,
        billing_cycle: pricing.billing_cycle,
        paid_amount: 0,
        next_billing_date: null,
        updated_at: new Date(),
      };
      let subscriptionId;
      if (existingFreePool) {
        await db("company_subscriptions").where("id", existingFreePool.id).update(values);
        subscriptionId = existingFreePool.id;
      } else {
        [subscriptionId] = await db("company_subscriptions").insert({
          company_id: companyId,
          ...values,
          created_at: new Date(),
        });
      }
      return res.status(201).json({
        success: true,
        message: "Free plan activated successfully",
        data: { subscription_id: subscriptionId, plan_name: plan.name },
      });
    }

    const trialEndDate = moment(startDate)
      .add(plan.trial_days, "days")
      .toDate();
    const endDate = trialEndDate;

    // Create trial subscription
    const [subscriptionId] = await db("company_subscriptions").insert({
      company_id: companyId,
      plan_id: plan_id,
      start_date: startDate,
      end_date: endDate,
      trial_end_date: trialEndDate,
      status: "trial",
      max_users: selectedUsers,
      storage_gb: plan.storage_gb || 1,
      billing_cycle: pricing.billing_cycle,
      next_billing_date: trialEndDate,
    });

    res.status(201).json({
      success: true,
      message: `Free trial started successfully. Trial ends on ${moment(trialEndDate).format("DD MMM YYYY")}`,
      data: {
        subscription_id: subscriptionId,
        trial_end_date: trialEndDate,
        plan_name: plan.name,
      },
    });
  } catch (error) {
    console.error("Error starting trial:", error);
    res.status(500).json({
      success: false,
      message: "Failed to start free trial",
    });
  }
};

// Upgrade/Change subscription plan
const upgradeSubscription = async (req, res) => {
  try {
    const {
      plan_id,
      payment_method,
      payment_details,
      users_count,
      billing_cycle,
    } = req.body;
    const companyId = req.user.company_id;

    // Get plan details
    const plan = await db("subscription_plans").where("id", plan_id).first();

    if (!plan) {
      return res.status(404).json({
        success: false,
        message: "Subscription plan not found",
      });
    }

    const selectedUsers = resolveSelectedUsers(users_count);
    const pricing = computePricing(plan, selectedUsers, billing_cycle);

    // Monthly and yearly seats are maintained as independent pools.
    const currentSubscription = await db("company_subscriptions")
      .where("company_id", companyId)
      .where("billing_cycle", pricing.billing_cycle)
      .orderBy("created_at", "desc")
      .first();

    const paidAmount = pricing.total_amount;

    const startDate = moment().toDate();
    const endDate = getEndDateForPlan(startDate, pricing.billing_cycle);

    let subscriptionId;

    if (currentSubscription) {
      // Update existing subscription
      await db("company_subscriptions")
        .where("id", currentSubscription.id)
        .update({
          plan_id: plan_id,
          start_date: startDate,
          end_date: endDate,
          status: "active",
          max_users: selectedUsers,
          storage_gb: plan.storage_gb || 1,
          billing_cycle: pricing.billing_cycle,
          paid_amount: paidAmount,
          last_payment_date: new Date(),
          next_billing_date: endDate,
          updated_at: new Date(),
        });
      subscriptionId = currentSubscription.id;
    } else {
      // Create new subscription
      [subscriptionId] = await db("company_subscriptions").insert({
        company_id: companyId,
        plan_id: plan_id,
        start_date: startDate,
        end_date: endDate,
        status: "active",
        max_users: selectedUsers,
        storage_gb: plan.storage_gb || 1,
        billing_cycle: pricing.billing_cycle,
        paid_amount: paidAmount,
        last_payment_date: new Date(),
        next_billing_date: endDate,
      });
    }

    // Record payment
    await db("subscription_payments").insert({
      company_id: companyId,
      subscription_id: subscriptionId,
      amount: paidAmount,
      payment_method: payment_method,
      transaction_id: `TXN${Date.now()}`,
      payment_reference: payment_details,
      status: "completed",
      payment_date: new Date(),
    });

    res.json({
      success: true,
      message: "Subscription upgraded successfully",
      data: {
        subscription_id: subscriptionId,
        plan_name: plan.name,
        amount_paid: paidAmount,
        next_billing_date: endDate,
      },
    });
  } catch (error) {
    console.error("Error upgrading subscription:", error);
    res.status(500).json({
      success: false,
      message: "Failed to upgrade subscription",
    });
  }
};

// Get payment history
const getPaymentHistory = async (req, res) => {
  try {
    const companyId = req.user.company_id;

    const payments = await db("subscription_payments")
      .where("company_id", companyId)
      .orderBy("payment_date", "desc");

    res.json({
      success: true,
      data: payments,
    });
  } catch (error) {
    console.error("Error fetching payment history:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch payment history",
    });
  }
};

// Check subscription status (middleware helper)
const checkSubscriptionStatus = async (req, res, next) => {
  try {
    const companyId = req.user.company_id;

    const subscription = await db("company_subscriptions")
      .where("company_id", companyId)
      .where(function () {
        this.where(function () {
          this.where("status", "trial").andWhere(
            "trial_end_date",
            ">=",
            db.fn.now(),
          );
        }).orWhere(function () {
          this.where("status", "active").andWhere(
            "end_date",
            ">=",
            db.fn.now(),
          );
        });
      })
      .first();

    if (!subscription) {
      return res.status(403).json({
        success: false,
        message:
          "No active subscription found. Please upgrade to continue using the service.",
        requires_subscription: true,
      });
    }

    // Check user limit
    const currentUsers = await db("employees")
      .where("company_id", companyId)
      .count("* as count")
      .first();

    const currentUserCount = parseInt(currentUsers.count, 10) || 0;
    const maxUsers = Number(subscription.max_users || 0);

    if (maxUsers > 0 && currentUserCount > maxUsers) {
      return res.status(403).json({
        success: false,
        message: `User limit exceeded. Your plan allows ${maxUsers} users, but you have ${currentUserCount}. Please upgrade your plan.`,
        user_limit_exceeded: true,
      });
    }

    req.subscription = subscription;
    next();
  } catch (error) {
    console.error("Error checking subscription status:", error);
    res.status(500).json({
      success: false,
      message: "Failed to verify subscription status",
    });
  }
};

// Update storage usage for a company
const updateStorageUsage = async (companyId) => {
  try {
    // Calculate total storage used by company uploads
    const fs = require("fs").promises;
    const path = require("path");

    const companyUploadsPath = path.join(
      __dirname,
      "../uploads/company_",
      companyId,
    );
    let totalSizeMB = 0;

    try {
      const files = await fs.readdir(companyUploadsPath, {
        withFileTypes: true,
      });

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
      console.log(
        `Upload directory not found for company ${companyId}, assuming 0 MB used`,
      );
    }

    // Update the subscription with current storage usage
    await db("company_subscriptions").where("company_id", companyId).update({
      used_storage_mb: totalSizeMB,
      updated_at: new Date(),
    });

    return totalSizeMB;
  } catch (error) {
    console.error("Error updating storage usage:", error);
    throw error;
  }
};

// Helper function to calculate directory size recursively
const calculateDirectorySize = async (dirPath) => {
  const fs = require("fs").promises;
  const path = require("path");
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
    const subscription = await db("company_subscriptions")
      .where("company_id", companyId)
      .whereIn("status", ["trial", "active"])
      .first();

    if (!subscription) {
      return res.status(403).json({
        success: false,
        message: "No active subscription found.",
        requires_subscription: true,
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
        message: `Storage limit exceeded. Your plan allows ${subscription.storage_gb}GB, but you're currently using ${Math.round((currentUsageMB / 1024) * 100) / 100}GB. Only ${Math.round(availableMB)}MB available. Please upgrade your plan for more storage.`,
        storage_limit_exceeded: true,
        current_usage: currentUsageMB,
        max_storage: maxStorageMB,
        available_storage: availableMB,
      });
    }

    req.storageInfo = {
      current_usage_mb: currentUsageMB,
      max_storage_mb: maxStorageMB,
      available_mb: maxStorageMB - currentUsageMB,
    };

    next();
  } catch (error) {
    console.error("Error checking storage limit:", error);
    res.status(500).json({
      success: false,
      message: "Failed to check storage limit",
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
  checkSubscriptionStatus,
  updateStorageUsage,
  checkStorageLimit,
};
