const knex = require("../db/db");
const {
  normalizeRole,
  canViewOrganization,
  getCurrentEmployeeId,
  getKpiVisibilityScope,
} = require("../utils/kpiAccess");
const {
  sendKpiCorrectiveActionNotification,
  sendKpiCorrectiveActionStatusUpdateNotification,
} = require("../utils/kpiOwnChat");

const REVIEW_STATUS = new Set(["PENDING", "IN_PROGRESS", "COMPLETED"]);

const safeText = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value);
  return text.length ? text : null;
};

const formatDateOnly = (value) => {
  if (!value) return null;
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const ownerNameExpr = () =>
  knex.raw(
    "TRIM(CONCAT(COALESCE(e.first_name,''), ' ', COALESCE(e.last_name,'')))",
  );

const getEmployeeMobile = (row) =>
  String(row?.mobile || "").trim() ||
  String(row?.officePhone || row?.office_phone || "").trim();

const statusDisplayLabel = (status) => {
  const key = String(status || "").toUpperCase();
  if (key === "COMPLETED") return "Completed";
  if (key === "IN_PROGRESS") return "In Progress";
  if (key === "PENDING") return "Pending";
  return key || "Updated";
};

const resolveCompanyAdminContact = async (companyId) => {
  if (!companyId) return null;
  const row = await knex("employees")
    .where({ company_id: companyId })
    .whereRaw("LOWER(TRIM(COALESCE(status, 'active'))) = ?", ["active"])
    .whereRaw("LOWER(TRIM(role)) IN ('admin', 'hr', 'ceo', 'superadmin')")
    .orderByRaw(`CASE LOWER(TRIM(role))
      WHEN 'admin' THEN 1
      WHEN 'hr' THEN 2
      WHEN 'ceo' THEN 3
      ELSE 4 END`)
    .select("mobile")
    .select("office_phone as officePhone")
    .select("first_name as firstName")
    .select("last_name as lastName")
    .first();

  if (!row) return null;
  const mobile = getEmployeeMobile(row);
  if (!mobile) return null;

  const name =
    `${String(row.firstName || "").trim()} ${String(row.lastName || "").trim()}`.trim() ||
    "Admin";
  return { mobile, name };
};

const ensureParameterReviewsExist = async (companyId) => {
  const missingRows = await knex("kpi_parameters as p")
    .join("kpi_templates as t", "p.kpi_template_id", "t.id")
    .leftJoin("kpi_parameter_reviews as r", function joinReviews() {
      this.on("r.kpi_template_id", "=", "p.kpi_template_id").andOn(
        "r.kpi_parameter_id",
        "=",
        "p.id",
      );
    })
    .whereNull("r.id")
    .modify((queryBuilder) => {
      if (companyId) queryBuilder.where("t.company_id", companyId);
    })
    .select("p.id as parameterId")
    .select("p.kpi_template_id as templateId")
    .select("t.owner_employee_id as reviewerEmployeeId");

  if (!missingRows.length) return;

  await knex("kpi_parameter_reviews").insert(
    missingRows.map((row) => ({
      kpi_template_id: row.templateId,
      kpi_parameter_id: row.parameterId,
      reviewer_employee_id: row.reviewerEmployeeId || null,
      feedback: null,
      target_date: null,
      status: "PENDING",
      created_at: knex.fn.now(),
      updated_at: knex.fn.now(),
    })),
  );
};

exports.getParameterReviews = async (req, res) => {
  try {
    const companyId = req.user?.company_id || null;
    const role = normalizeRole(req.user?.role);

    await ensureParameterReviewsExist(companyId);

    const query = knex("kpi_parameter_reviews as r")
      .leftJoin("kpi_templates as t", "r.kpi_template_id", "t.id")
      .leftJoin("kpi_parameters as p", "r.kpi_parameter_id", "p.id")
      .leftJoin("employees as e", "t.owner_employee_id", "e.id")
      .select("r.id as id")
      .select("r.feedback as feedback")
      .select("r.target_date as targetDate")
      .select("r.status as status")
      .select("r.updated_at as updatedAt")
      .select("r.submitted_at as submittedAt")
      .select("r.kpi_template_id as templateId")
      .select("t.title as templateTitle")
      .select("t.created_at as templateCreatedAt")
      .select("e.id as ownerId")
      .select({ ownerFullName: ownerNameExpr() })
      .select("p.name as parameterName")
      .select("p.uom as uom")
      .select("p.reference as reference")
      .select("p.commitment as commitment")
      .select("p.weightage as weightage")
      .select("p.achievement as achievement")
      .select("p.kpi_score as kpiScore")
      .select("p.kpi_definition as definition")
      .select("p.measurement_method as measurement")
      .select("p.data_source as dataSource")
      .select("p.lead_indicators as leadIndicators")
      .orderBy("r.updated_at", "desc")
      .orderBy("r.id", "desc");

    if (companyId) {
      query.where("t.company_id", companyId);
    }

    const scope = getKpiVisibilityScope(req.user);
    const currentEmployeeId = getCurrentEmployeeId(req.user);
    const currentDepartmentId =
      Number(req.user?.department_id || 0) || null;
    if (scope === "self") {
      if (currentEmployeeId) query.where("t.owner_employee_id", currentEmployeeId);
    } else if (scope === "department") {
      if (currentDepartmentId) query.where("t.department_id", currentDepartmentId);
    }

    const rows = await query;
    const payload = rows.map((row) => ({
      id: Number(row.id),
      feedback: safeText(row.feedback),
      targetDate: formatDateOnly(row.targetDate),
      status: safeText(row.status),
      updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
      submittedAt: row.submittedAt ? new Date(row.submittedAt).toISOString() : null,
      templateId: Number(row.templateId || 0),
      kpiTemplate: {
        title: safeText(row.templateTitle),
        createdAt: row.templateCreatedAt
          ? new Date(row.templateCreatedAt).toISOString()
          : null,
        ownerUser: row.ownerId
          ? {
              id: Number(row.ownerId),
              fullName: safeText(row.ownerFullName) || "Unassigned",
            }
          : null,
      },
      kpiParameter: safeText(row.parameterName)
        ? {
            name: safeText(row.parameterName),
            uom: safeText(row.uom),
            reference: row.reference == null ? null : Number(row.reference),
            commitment: row.commitment == null ? null : Number(row.commitment),
            weightage: row.weightage == null ? null : Number(row.weightage),
            achievement: row.achievement == null ? null : Number(row.achievement),
            kpiScore: row.kpiScore == null ? null : Number(row.kpiScore),
            definition: safeText(row.definition),
            measurement: safeText(row.measurement),
            dataSource: safeText(row.dataSource),
            leadIndicators: safeText(row.leadIndicators),
          }
        : null,
    }));

    return res.json(payload);
  } catch (error) {
    console.error("KPI parameter reviews load error:", error);
    return res.status(500).json({ message: "Unable to load KPI reviews." });
  }
};

exports.updateParameterReviewStatus = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ message: "Invalid id" });
    }

    const status = String(req.body?.status || "").toUpperCase().trim();
    if (!REVIEW_STATUS.has(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    const companyId = req.user?.company_id || null;
    const role = normalizeRole(req.user?.role);
    const actorEmployeeId = getCurrentEmployeeId(req.user);
    const baseQuery = knex("kpi_parameter_reviews as r")
      .leftJoin("kpi_templates as t", "r.kpi_template_id", "t.id")
      .where("r.id", id);
    if (companyId) baseQuery.andWhere("t.company_id", companyId);

    const existing = await baseQuery
      .clone()
      .select("r.id", "r.status")
      .first();
    if (!existing) {
      return res.status(404).json({ message: "Review not found" });
    }

    await knex("kpi_parameter_reviews")
      .where({ id })
      .update({ status, updated_at: knex.fn.now() });

    // Notify reviewer about status update (optional, if OwnChat env configured)
    try {
      const detail = await knex("kpi_parameter_reviews as r")
        .leftJoin("kpi_templates as t", "r.kpi_template_id", "t.id")
        .leftJoin("kpi_parameters as p", "r.kpi_parameter_id", "p.id")
        .leftJoin("employees as owner", "t.owner_employee_id", "owner.id")
        .leftJoin("employees as reviewer", "r.reviewer_employee_id", "reviewer.id")
        .where("r.id", id)
        .modify((query) => {
          if (companyId) query.andWhere("t.company_id", companyId);
        })
        .select("t.owner_employee_id as ownerEmployeeId")
        .select("r.reviewer_employee_id as reviewerEmployeeId")
        .select("r.feedback as feedback")
        .select("r.target_date as targetDate")
        .select("reviewer.mobile as reviewerMobile")
        .select("reviewer.office_phone as reviewerOfficePhone")
        .select("owner.mobile as ownerMobile")
        .select("owner.office_phone as ownerOfficePhone")
        .select(
          knex.raw(
            "TRIM(CONCAT(COALESCE(reviewer.first_name,''), ' ', COALESCE(reviewer.last_name,''))) as reviewerName",
          ),
        )
        .select(
          knex.raw(
            "TRIM(CONCAT(COALESCE(owner.first_name,''), ' ', COALESCE(owner.last_name,''))) as ownerName",
          ),
        )
        .select("p.name as parameterName")
        .select("t.company_id as companyId")
        .first();

      const correctiveAction =
        String(detail?.feedback || "").trim() ||
        `KPI corrective action marked as ${statusDisplayLabel(status)}`;
      const reviewerMobile = getEmployeeMobile({
        mobile: detail?.reviewerMobile,
        officePhone: detail?.reviewerOfficePhone,
      });
      const ownerMobile = getEmployeeMobile({
        mobile: detail?.ownerMobile,
        officePhone: detail?.ownerOfficePhone,
      });

      const ownerEmployeeId = Number(detail?.ownerEmployeeId || 0) || null;
      const reviewerEmployeeId = Number(detail?.reviewerEmployeeId || 0) || null;
      const notificationCompanyId = Number(detail?.companyId || 0) || null;

      const actorIsReviewer =
        actorEmployeeId && reviewerEmployeeId && actorEmployeeId === reviewerEmployeeId;
      const actorIsOwner =
        actorEmployeeId && ownerEmployeeId && actorEmployeeId === ownerEmployeeId;
      const actorIsOrgUser = canViewOrganization(role);

      const recipients = [];
      const addRecipient = ({ mobile, name, assignedTo }) => {
        const cleanMobile = String(mobile || "").trim();
        const cleanName = String(name || "").trim();
        if (!cleanMobile || !cleanName) return;
        const exists = recipients.some(
          (recipient) => recipient.mobile === cleanMobile,
        );
        if (exists) return;
        recipients.push({
          mobile: cleanMobile,
          name: cleanName,
          assignedTo: String(assignedTo || "").trim() || "Reviewer",
        });
      };

      let assignedToName = detail?.ownerName || "Employee";

      if (actorIsOwner && !actorIsOrgUser) {
        const adminContact = await resolveCompanyAdminContact(notificationCompanyId);
        addRecipient({
          mobile: reviewerMobile || adminContact?.mobile || "",
          name: detail?.reviewerName || adminContact?.name || "Admin",
          assignedTo: detail?.ownerName || "Employee",
        });
        assignedToName = detail?.ownerName || "Employee";
      } else if (actorIsOrgUser || actorIsReviewer) {
        addRecipient({
          mobile: ownerMobile,
          name: detail?.ownerName || "Employee",
          assignedTo: detail?.reviewerName || "Reviewer",
        });
        assignedToName = detail?.reviewerName || "Reviewer";
      } else {
        addRecipient({
          mobile: ownerMobile || reviewerMobile,
          name: detail?.ownerName || detail?.reviewerName || "Employee",
          assignedTo: detail?.reviewerName || "Reviewer",
        });
      }

      if (status === "COMPLETED") {
        const adminContact = reviewerMobile
          ? null
          : await resolveCompanyAdminContact(notificationCompanyId);
        addRecipient({
          mobile: ownerMobile,
          name: detail?.ownerName || "Employee",
          assignedTo: detail?.reviewerName || "Reviewer",
        });
        addRecipient({
          mobile: reviewerMobile || adminContact?.mobile || "",
          name: detail?.reviewerName || adminContact?.name || "Admin",
          assignedTo: detail?.ownerName || "Employee",
        });
      }

      if (recipients.length) {
        await Promise.all(
          recipients.map((recipient) =>
            sendKpiCorrectiveActionStatusUpdateNotification({
              recipientName: recipient.name,
              mobileNumber: recipient.mobile,
              kpiName: detail?.parameterName || "KPI",
              assignedToName: recipient.assignedTo || assignedToName,
              correctiveAction,
              status: statusDisplayLabel(status),
              targetDate: detail?.targetDate
                ? new Date(detail.targetDate)
                : new Date(),
            }),
          ),
        );
      } else {
        console.warn(
          `[KPI status] notification skipped id=${id} status=${status} ownerMobile=${ownerMobile || "missing"} reviewerMobile=${reviewerMobile || "missing"}`,
        );
      }
    } catch (notifyError) {
      console.warn("[KPI status] notification error:", notifyError);
      // best-effort notification; never fail the API
    }

    return res.json({ success: true, id, status });
  } catch (error) {
    console.error("KPI parameter review status update error:", error);
    return res.status(500).json({ message: "Unable to update review status." });
  }
};

exports.saveParameterReview = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ message: "Invalid id" });
    }

    const companyId = req.user?.company_id || null;
    const baseQuery = knex("kpi_parameter_reviews as r")
      .leftJoin("kpi_templates as t", "r.kpi_template_id", "t.id")
      .where("r.id", id);
    if (companyId) baseQuery.andWhere("t.company_id", companyId);

    const existing = await baseQuery
      .clone()
      .select("r.id")
      .select("r.submitted_at as submittedAt")
      .first();
    if (!existing) {
      return res.status(404).json({ message: "Review not found" });
    }
    if (existing.submittedAt) {
      return res.status(400).json({ message: "Submitted KPI review cannot be edited." });
    }

    const feedback = safeText(req.body?.feedback) || null;
    const targetDateRaw = req.body?.targetDate;
    const targetDate = formatDateOnly(targetDateRaw);

    await knex("kpi_parameter_reviews")
      .where({ id })
      .update({
        feedback,
        target_date: targetDate,
        updated_at: knex.fn.now(),
      });

    return res.json({ success: true, id, feedback, targetDate });
  } catch (error) {
    console.error("KPI parameter review save error:", error);
    return res.status(500).json({ message: "Unable to save KPI review." });
  }
};

exports.submitParameterReviews = async (req, res) => {
  try {
    const templateId = Number(req.params.templateId);
    if (!Number.isFinite(templateId) || templateId <= 0) {
      return res.status(400).json({ message: "Invalid templateId" });
    }

    const companyId = req.user?.company_id || null;
    const role = normalizeRole(req.user?.role);
    const currentEmployeeId = getCurrentEmployeeId(req.user);

    const templateQuery = knex("kpi_templates as t").where("t.id", templateId);
    if (companyId) templateQuery.andWhere("t.company_id", companyId);
    const scope = getKpiVisibilityScope(req.user);
    const currentDepartmentId =
      Number(req.user?.department_id || 0) || null;
    if (scope === "self" && currentEmployeeId) {
      templateQuery.andWhere("t.owner_employee_id", currentEmployeeId);
    } else if (scope === "department" && currentDepartmentId) {
      templateQuery.andWhere("t.department_id", currentDepartmentId);
    }

    const template = await templateQuery.first("t.id");
    if (!template) {
      return res.status(404).json({ message: "Template not found." });
    }

    await knex("kpi_parameter_reviews")
      .where({ kpi_template_id: templateId })
      .whereNull("submitted_at")
      .update({
        submitted_at: knex.fn.now(),
        updated_at: knex.fn.now(),
      });

    // Notify employees (scorecard owners) about corrective actions (best-effort)
    try {
      const rows = await knex("kpi_parameter_reviews as r")
        .leftJoin("kpi_templates as t", "r.kpi_template_id", "t.id")
        .leftJoin("kpi_parameters as p", "r.kpi_parameter_id", "p.id")
        .leftJoin("employees as owner", "t.owner_employee_id", "owner.id")
        .where("r.kpi_template_id", templateId)
        .modify((query) => {
          if (companyId) query.andWhere("t.company_id", companyId);
        })
        .select("r.feedback as feedback")
        .select("r.target_date as targetDate")
        .select("owner.mobile as ownerMobile")
        .select("owner.office_phone as ownerOfficePhone")
        .select(
          knex.raw(
            "TRIM(CONCAT(COALESCE(owner.first_name,''), ' ', COALESCE(owner.last_name,''))) as ownerName",
          ),
        )
        .select("p.name as parameterName");

      await Promise.all(
        rows.map(async (row) => {
          const correctiveAction = String(row.feedback || "").trim();
          const ownerMobile = String(row.ownerMobile || row.ownerOfficePhone || "").trim();
          if (!ownerMobile || !row.ownerName || !correctiveAction || !row.targetDate) {
            console.warn(
              `[KPI submit] notification skipped review owner=${row.ownerName || "unknown"} mobile=${ownerMobile || "missing"} feedback=${correctiveAction ? "yes" : "no"} targetDate=${row.targetDate ? "yes" : "no"}`,
            );
            return;
          }
          await sendKpiCorrectiveActionNotification({
            recipientName: row.ownerName,
            mobileNumber: ownerMobile,
            kpiName: row.parameterName || "KPI",
            correctiveAction,
            targetDate: new Date(row.targetDate),
          });
        }),
      );
    } catch (notifyError) {
      console.warn("[KPI submit] notification error:", notifyError);
    }

    return res.json({ success: true, templateId });
  } catch (error) {
    console.error("KPI parameter reviews submit error:", error);
    return res.status(500).json({ message: "Unable to submit KPI reviews." });
  }
};
