const db = require("../db/db");
const { v4: uuidv4 } = require("uuid");

const isSuperAdminUser = (user = {}) =>
  String(user.role || "").toLowerCase() === "superadmin";

// A company can retain historical trial and paid subscription records.  Always
// surface the current paid subscription first, instead of joining an arbitrary
// old trial row.
const currentSubscriptionJoin = () =>
  db.raw(`cs.id = (
    SELECT ranked_cs.id
    FROM company_subscriptions AS ranked_cs
    WHERE ranked_cs.company_id = companies.id
    ORDER BY
      CASE
        WHEN ranked_cs.status = 'active' THEN 0
        WHEN ranked_cs.status = 'trial' THEN 1
        ELSE 2
      END,
      COALESCE(ranked_cs.last_payment_date, ranked_cs.updated_at, ranked_cs.created_at) DESC,
      ranked_cs.id DESC
    LIMIT 1
  )`);

const deleteOrganizationDataForSuperAdmin = async (organizationId) => {
  await db.transaction(async (trx) => {
    await trx.raw("SET FOREIGN_KEY_CHECKS = 0");

    try {
      const companyTables = await trx("information_schema.columns")
        .select("table_name")
        .whereRaw("table_schema = DATABASE()")
        .where("column_name", "company_id")
        .groupBy("table_name");

      for (const row of companyTables) {
        const tableName = row.table_name || row.TABLE_NAME;
        if (!tableName || tableName === "companies") continue;
        await trx(tableName).where("company_id", organizationId).del();
      }

      await trx("companies").where({ id: organizationId }).del();
    } finally {
      await trx.raw("SET FOREIGN_KEY_CHECKS = 1");
    }
  });
};

// Get all organizations (companies)
const getOrganizations = async (req, res) => {
  try {
    const { company_id } = req.user;

    console.log("User info:", {
      userRole: req.user.role,
      userType: req.user.type,
      company_id: company_id,
      user: req.user,
    });

    // For super admin, get all companies with subscription info and user counts
    // For regular users, get only their company
    let organizations;
    if (isSuperAdminUser(req.user)) {
      console.log("Fetching all companies for superadmin");
      organizations = await db("companies")
        .leftJoin("company_subscriptions as cs", currentSubscriptionJoin())
        .leftJoin(
          "subscription_plans",
          "cs.plan_id",
          "subscription_plans.id",
        )
        .leftJoin("employees", "companies.id", "employees.company_id")
        .leftJoin("users", "employees.email", "users.email")
        .select([
          "companies.id",
          "companies.company_name as name",
          "companies.legal_name as owner",
          "companies.created_at",
          "companies.updated_at",
          db.raw(`(
            SELECT contact_employee.email
            FROM employees AS contact_employee
            WHERE contact_employee.company_id = companies.id
              AND NULLIF(contact_employee.email, '') IS NOT NULL
            ORDER BY contact_employee.created_at ASC, contact_employee.id ASC
            LIMIT 1
          ) as contactEmail`),
          db.raw(`(
            SELECT COALESCE(NULLIF(contact_employee.mobile, ''), NULLIF(contact_employee.email, ''))
            FROM employees AS contact_employee
            WHERE contact_employee.company_id = companies.id
            ORDER BY contact_employee.created_at ASC, contact_employee.id ASC
            LIMIT 1
          ) as contact`),
          "subscription_plans.name as plan",
          "cs.status as subscriptionStatus",
          "cs.start_date as subscriptionStartDate",
          "cs.trial_end_date",
          "cs.end_date as subscriptionEndDate",
          "cs.storage_gb as totalStorage",
          db.raw(
            "DATEDIFF(COALESCE(cs.end_date, cs.trial_end_date), CURDATE()) as daysLeft",
          ),
          db.raw("COALESCE(cs.paid_amount, 0) as revenue"),
          db.raw("COUNT(DISTINCT employees.id) as user_count"),
        ])
        .groupBy(
          "companies.id",
          "companies.company_name",
          "companies.legal_name",
          "companies.created_at",
          "companies.updated_at",
          "subscription_plans.name",
          "cs.status",
          "cs.start_date",
          "cs.trial_end_date",
          "cs.end_date",
          "cs.storage_gb",
          "cs.paid_amount",
        )
        .orderBy("companies.created_at", "desc");
    } else {
      console.log("Fetching company for regular user, company_id:", company_id);
      // For regular users, if no company_id assigned, return empty array
      if (!company_id) {
        console.log("No company_id found for user, returning empty array");
        return res.json({
          success: true,
          data: [],
          message: "User not assigned to any company",
        });
      }
      organizations = await db("companies")
        .leftJoin("company_subscriptions as cs", currentSubscriptionJoin())
        .leftJoin(
          "subscription_plans",
          "cs.plan_id",
          "subscription_plans.id",
        )
        .leftJoin("employees", "companies.id", "employees.company_id")
        .leftJoin("users", "employees.email", "users.email")
        .where("companies.id", company_id)
        .select([
          "companies.id",
          "companies.company_name as name",
          "companies.legal_name as owner",
          "companies.created_at",
          "companies.updated_at",
          db.raw(`(
            SELECT contact_employee.email
            FROM employees AS contact_employee
            WHERE contact_employee.company_id = companies.id
              AND NULLIF(contact_employee.email, '') IS NOT NULL
            ORDER BY contact_employee.created_at ASC, contact_employee.id ASC
            LIMIT 1
          ) as contactEmail`),
          db.raw(`(
            SELECT COALESCE(NULLIF(contact_employee.mobile, ''), NULLIF(contact_employee.email, ''))
            FROM employees AS contact_employee
            WHERE contact_employee.company_id = companies.id
            ORDER BY contact_employee.created_at ASC, contact_employee.id ASC
            LIMIT 1
          ) as contact`),
          "subscription_plans.name as plan",
          "cs.status as subscriptionStatus",
          "cs.start_date as subscriptionStartDate",
          "cs.trial_end_date",
          "cs.end_date as subscriptionEndDate",
          "cs.storage_gb as totalStorage",
          db.raw(
            "DATEDIFF(COALESCE(cs.end_date, cs.trial_end_date), CURDATE()) as daysLeft",
          ),
          db.raw("COALESCE(cs.paid_amount, 0) as revenue"),
          db.raw("COUNT(DISTINCT employees.id) as user_count"),
        ])
        .groupBy(
          "companies.id",
          "companies.company_name",
          "companies.legal_name",
          "companies.created_at",
          "companies.updated_at",
          "subscription_plans.name",
          "cs.status",
          "cs.start_date",
          "cs.trial_end_date",
          "cs.end_date",
          "cs.storage_gb",
          "cs.paid_amount",
        )
        .orderBy("companies.created_at", "desc");
    }

    // Transform the data to match frontend expectations
    console.log("Raw organizations data:", organizations);
    const transformedOrganizations = organizations.map((org) => {
      console.log("Processing org:", {
        name: org.name,
        trial_end_date: org.trial_end_date,
        daysLeft: org.daysLeft,
        plan: org.plan,
      });

      const subscriptionStatus = String(org.subscriptionStatus || "").toLowerCase();
      const isTrial = subscriptionStatus === "trial";
      const subscriptionEndDate = org.subscriptionEndDate || org.trial_end_date;

      // Days remaining applies to the actual subscription end date. For a
      // paid plan, a historical trial end date must never make it a trial.
      let calculatedDaysLeft = 0;
      if (subscriptionEndDate) {
        const trialEndDate = new Date(subscriptionEndDate);
        const currentDate = new Date();
        const diffTime = trialEndDate - currentDate;
        calculatedDaysLeft = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        console.log(`Days calculation for ${org.name}:`, {
          subscription_end_date: subscriptionEndDate,
          current_date: currentDate.toISOString().split("T")[0],
          calculated_days_left: calculatedDaysLeft,
        });
      }

      return {
        id: org.id?.toString() || "",
        name: org.name || "",
        email: org.contactEmail || "",
        contact: org.contact || org.contactEmail || "",
        owner: org.owner || "",
        status: !subscriptionStatus
          ? "inactive"
          : calculatedDaysLeft < 0
            ? "expired"
            : isTrial
              ? "trial"
              : subscriptionStatus === "active"
                ? "active"
                : subscriptionStatus,
        plan: org.plan || (isTrial ? "Trial" : "Not subscribed"),
        users: org.user_count || 0, // Use user_count from query
        storage: "0MB", // No used storage field available
        totalStorage: `${org.totalStorage || 2}GB`,
        daysLeft: Number(calculatedDaysLeft), // Ensure it's a number
        revenue: org.revenue ? `₹${org.revenue}.00` : "₹0.00",
        createdAt: org.created_at,
        updatedAt: org.updated_at,
        trialStartDate: org.subscriptionStartDate || null,
        trialEndDate: subscriptionEndDate || null,
        lastLogin: null, // Can be added if needed
      };
    });

    res.json({
      success: true,
      data: transformedOrganizations,
    });
  } catch (error) {
    console.error("Error fetching organizations:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch organizations",
    });
  }
};

// Get single company by ID
const getOrganizationById = async (req, res) => {
  try {
    const { id } = req.params;
    const { company_id } = req.user;

    console.log("Get organization by ID - User info:", {
      userRole: req.user.role,
      userType: req.user.type,
      company_id: company_id,
      requestedId: id,
    });

    let organization;
    if (isSuperAdminUser(req.user)) {
      organization = await db("companies").where({ id }).first();
    } else {
      organization = await db("companies").where({ id, company_id }).first();
    }

    if (!organization) {
      return res
        .status(404)
        .json({ success: false, error: "Organization not found" });
    }

    res.json({
      success: true,
      data: organization,
    });
  } catch (error) {
    console.error("Error fetching organization:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch organization",
    });
  }
};

// Create new company
const createOrganization = async (req, res) => {
  try {
    const { company_id } = req.user;
    const organizationData = {
      company_id: uuidv4(), // Generate unique company_id
      ...req.body,
      created_at: new Date(),
      updated_at: new Date(),
    };

    await db("companies").insert(organizationData);

    res.status(201).json({
      success: true,
      message: "Organization created successfully",
      data: organizationData,
    });
  } catch (error) {
    console.error("Error creating organization:", error);
    res.status(500).json({
      success: false,
      error: "Failed to create organization",
    });
  }
};

// Update company
const updateOrganization = async (req, res) => {
  try {
    const { id } = req.params;
    const { company_id } = req.user;

    console.log("Update organization - User info:", {
      userRole: req.user.role,
      userType: req.user.type,
      company_id: company_id,
      organizationId: id,
    });

    let organization;
    if (isSuperAdminUser(req.user)) {
      organization = await db("companies").where({ id }).first();
    } else {
      organization = await db("companies").where({ id, company_id }).first();
    }

    if (!organization) {
      return res.status(404).json({
        success: false,
        error: "Organization not found",
      });
    }

    const updateData = {
      ...req.body,
      updated_at: new Date(),
    };

    if (isSuperAdminUser(req.user)) {
      await db("companies").where({ id }).update(updateData);
    } else {
      await db("companies").where({ id, company_id }).update(updateData);
    }

    res.json({
      success: true,
      message: "Organization updated successfully",
    });
  } catch (error) {
    console.error("Error updating organization:", error);
    res.status(500).json({
      success: false,
      error: "Failed to update organization",
    });
  }
};

// Delete company
const deleteOrganization = async (req, res) => {
  try {
    const { id } = req.params;
    const { company_id } = req.user;

    console.log("Delete organization - User info:", {
      userRole: req.user.role,
      userType: req.user.type,
      company_id: company_id,
      organizationId: id,
    });

    let deleted;
    if (isSuperAdminUser(req.user)) {
      const organization = await db("companies").where({ id }).first();
      if (!organization) {
        return res.status(404).json({
          success: false,
          error: "Organization not found",
        });
      }

      await deleteOrganizationDataForSuperAdmin(id);
      deleted = 1;
    } else {
      const users = await db("users").where({ company_id }).first();

      if (users) {
        return res.status(400).json({
          success: false,
          error: "Cannot delete organization with associated users",
        });
      }

      deleted = await db("companies").where({ id, company_id }).del();
    }

    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: "Organization not found",
      });
    }

    res.json({
      success: true,
      message: "Organization deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting organization:", error);
    res.status(500).json({
      success: false,
      error: "Failed to delete organization",
    });
  }
};

module.exports = {
  getOrganizations,
  getOrganizationById,
  createOrganization,
  updateOrganization,
  deleteOrganization,
};
