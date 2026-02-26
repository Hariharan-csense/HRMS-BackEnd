const db = require("../db/db");

const requireAuthType = (req, res, type) => {
  if (!req.user || req.user.type !== type) {
    res.status(403).json({ message: "Access denied" });
    return false;
  }
  return true;
};

const clampScore = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(10, n));
};

const parseList = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return [value];
};

const isNumeric = (value) => {
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "string") return false;
  return /^\d+$/.test(value.trim());
};

const buildRecipientsQuery = async ({
  companyId,
  recipientType,
  selectedEmployeeIds,
  selectedDepartment,
  selectedDesignation,
}) => {
  const query = db("employees").select("employees.id").where("employees.company_id", companyId);

  if (recipientType === "employee" && selectedEmployeeIds.length > 0) {
    const ids = selectedEmployeeIds.filter(isNumeric).map((x) => Number(x));
    if (ids.length > 0) {
      query.whereIn("employees.id", ids);
    }
    return query;
  }

  if (recipientType === "department" && selectedDepartment.length > 0) {
    const ids = selectedDepartment.filter(isNumeric).map((x) => Number(x));
    const names = selectedDepartment.filter((x) => !isNumeric(x)).map((x) => String(x).trim()).filter(Boolean);

    if (ids.length > 0) {
      query.whereIn("employees.department_id", ids);
      return query;
    }

    if (names.length > 0) {
      query
        .join("departments", "employees.department_id", "departments.id")
        .whereIn("departments.name", names);
      return query;
    }

    return query.whereRaw("1=0");
  }

  if (recipientType === "designation" && selectedDesignation.length > 0) {
    const ids = selectedDesignation.filter(isNumeric).map((x) => Number(x));
    const names = selectedDesignation.filter((x) => !isNumeric(x)).map((x) => String(x).trim()).filter(Boolean);

    if (ids.length > 0) {
      query.whereIn("employees.designation_id", ids);
      return query;
    }

    if (names.length > 0) {
      query
        .join("designations", "employees.designation_id", "designations.id")
        .whereIn("designations.name", names);
      return query;
    }

    return query.whereRaw("1=0");
  }

  return query;
};

// Admin: create and send
const createPulseSurvey = async (req, res) => {
  if (!requireAuthType(req, res, "admin")) return;

  const {
    title,
    message,
    recipientType = "all",
    selectedEmployeeIds,
    selectedDepartment,
    selectedDesignation,
    allowAnonymous = false,
  } = req.body || {};

  const companyId = req.user.company_id;
  const createdByUserId = req.user.id;

  if (!companyId) return res.status(400).json({ message: "Missing company_id" });
  if (!title || !String(title).trim()) {
    return res.status(400).json({ message: "Title is required" });
  }

  const empList = parseList(selectedEmployeeIds);
  const deptList = parseList(selectedDepartment);
  const desigList = parseList(selectedDesignation);

  try {
    const recipientsQuery = await buildRecipientsQuery({
      companyId,
      recipientType,
      selectedEmployeeIds: empList,
      selectedDepartment: deptList,
      selectedDesignation: desigList,
    });

    const recipients = await recipientsQuery;
    if (!recipients.length) {
      return res.status(400).json({ message: "No recipients found" });
    }

    const [surveyId] = await db("pulse_surveys").insert({
      company_id: companyId,
      created_by_user_id: createdByUserId,
      title: String(title).trim(),
      message: message ? String(message) : null,
      recipient_type: recipientType,
      allow_anonymous: Boolean(allowAnonymous),
      status: "sent",
      total_sent: recipients.length,
      created_at: new Date(),
      updated_at: new Date(),
    });

    const rows = recipients.map((r) => ({
      survey_id: surveyId,
      employee_id: r.id,
      company_id: companyId,
      sent_at: new Date(),
    }));

    // Insert in chunks to avoid max packet issues
    const chunkSize = 500;
    for (let i = 0; i < rows.length; i += chunkSize) {
      // eslint-disable-next-line no-await-in-loop
      await db("pulse_survey_recipients").insert(rows.slice(i, i + chunkSize));
    }

    return res.status(201).json({
      id: surveyId,
      title: String(title).trim(),
      message: message ? String(message) : "",
      recipientType,
      allowAnonymous: Boolean(allowAnonymous),
      totalSent: recipients.length,
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("createPulseSurvey error:", error);
    return res.status(500).json({ message: "Failed to create survey" });
  }
};

// Admin: list surveys with counts
const getAdminPulseSurveys = async (req, res) => {
  if (!requireAuthType(req, res, "admin")) return;

  const companyId = req.user.company_id;
  try {
    const surveys = await db("pulse_surveys as s")
      .leftJoin("pulse_survey_responses as r", "s.id", "r.survey_id")
      .where("s.company_id", companyId)
      .groupBy("s.id")
      .orderBy("s.created_at", "desc")
      .select(
        "s.*",
        db.raw("COUNT(r.id) as responseCount"),
        db.raw("AVG(r.score) as avgScore"),
      );

    return res.json(
      surveys.map((s) => ({
        id: s.id,
        title: s.title,
        message: s.message || "",
        recipientType: s.recipient_type,
        allowAnonymous: Boolean(s.allow_anonymous),
        status: s.status,
        totalSent: s.total_sent,
        createdAt: s.created_at,
        updatedAt: s.updated_at,
        responseCount: Number(s.responseCount || 0),
        avgScore: s.avgScore === null ? 0 : Number(s.avgScore),
      })),
    );
  } catch (error) {
    console.error("getAdminPulseSurveys error:", error);
    return res.status(500).json({ message: "Failed to fetch surveys" });
  }
};

// Admin: get one survey (with counts)
const getAdminPulseSurveyById = async (req, res) => {
  if (!requireAuthType(req, res, "admin")) return;

  const companyId = req.user.company_id;
  const { id } = req.params;

  try {
    const rows = await db("pulse_surveys as s")
      .leftJoin("pulse_survey_responses as r", "s.id", "r.survey_id")
      .where("s.company_id", companyId)
      .andWhere("s.id", Number(id))
      .groupBy("s.id")
      .select(
        "s.*",
        db.raw("COUNT(r.id) as responseCount"),
        db.raw("AVG(r.score) as avgScore"),
      );

    const s = rows[0];
    if (!s) return res.status(404).json({ message: "Survey not found" });

    return res.json({
      id: s.id,
      title: s.title,
      message: s.message || "",
      recipientType: s.recipient_type,
      allowAnonymous: Boolean(s.allow_anonymous),
      status: s.status,
      totalSent: s.total_sent,
      createdAt: s.created_at,
      updatedAt: s.updated_at,
      responseCount: Number(s.responseCount || 0),
      avgScore: s.avgScore === null ? 0 : Number(s.avgScore),
    });
  } catch (error) {
    console.error("getAdminPulseSurveyById error:", error);
    return res.status(500).json({ message: "Failed to fetch survey" });
  }
};

// Admin: overview KPIs + trends
const getAdminPulseOverview = async (req, res) => {
  if (!requireAuthType(req, res, "admin")) return;

  const companyId = req.user.company_id;

  try {
    const [{ totalEmployees }] = await db("employees")
      .where("company_id", companyId)
      .count({ totalEmployees: "*" });

    const responses = await db("pulse_survey_responses")
      .where("company_id", companyId)
      .select("score", "responded_at");

    const scores = responses.map((r) => clampScore(r.score));
    const avgHappiness = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;

    const latest = responses
      .slice()
      .sort((a, b) => String(b.responded_at).localeCompare(String(a.responded_at)))[0];
    const avgScoreTrend = latest ? clampScore(latest.score) : 0;

    const [{ departments }] = await db("employees")
      .where("company_id", companyId)
      .whereNotNull("department_id")
      .countDistinct({ departments: "department_id" });

    const byGender = await db("employees as e")
      .leftJoin("pulse_survey_responses as r", "e.id", "r.employee_id")
      .where("e.company_id", companyId)
      .groupBy("e.gender")
      .select(
        "e.gender as gender",
        db.raw("COUNT(DISTINCT e.id) as employees"),
        db.raw("AVG(r.score) as avgScore"),
      );

    const normalizeGender = (g) => String(g || "").toLowerCase();
    const maleRow = byGender.find((x) => normalizeGender(x.gender) === "male");
    const femaleRow = byGender.find((x) => normalizeGender(x.gender) === "female");

    const deptDetails = await db("departments as d")
      .leftJoin("employees as e", "e.department_id", "d.id")
      .leftJoin("pulse_survey_responses as r", "r.employee_id", "e.id")
      .where("e.company_id", companyId)
      .groupBy("d.id")
      .select(
        "d.name as name",
        db.raw("COUNT(DISTINCT e.id) as employees"),
        db.raw("AVG(r.score) as avgScore"),
      )
      .orderBy("d.name", "asc");

    const toPoint = (label, score) => ({ label, score: Number(score || 0) });

    // Trend buckets computed in JS (last N)
    const byDay = new Map();
    const byWeek = new Map();
    const byMonth = new Map();
    for (const r of responses) {
      const d = new Date(r.responded_at);
      const score = clampScore(r.score);

      const dayKey = d.toISOString().slice(0, 10);
      const dayLabel = d.toLocaleDateString(undefined, { weekday: "short" });
      const dayPrev = byDay.get(dayKey) || { label: dayLabel, sum: 0, count: 0 };
      byDay.set(dayKey, { label: dayPrev.label, sum: dayPrev.sum + score, count: dayPrev.count + 1 });

      const year = d.getFullYear();
      const first = new Date(Date.UTC(year, 0, 1));
      const days = Math.floor((Date.UTC(year, d.getMonth(), d.getDate()) - first.getTime()) / 86400000);
      const week = Math.floor(days / 7) + 1;
      const weekKey = `${year}-W${String(week).padStart(2, "0")}`;
      const weekLabel = `W${week}`;
      const weekPrev = byWeek.get(weekKey) || { label: weekLabel, sum: 0, count: 0 };
      byWeek.set(weekKey, { label: weekPrev.label, sum: weekPrev.sum + score, count: weekPrev.count + 1 });

      const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const monthLabel = d.toLocaleDateString(undefined, { month: "short" });
      const monthPrev = byMonth.get(monthKey) || { label: monthLabel, sum: 0, count: 0 };
      byMonth.set(monthKey, { label: monthPrev.label, sum: monthPrev.sum + score, count: monthPrev.count + 1 });
    }

    const dayTrend = [...byDay.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-7)
      .map(([, v]) => toPoint(v.label, v.count ? v.sum / v.count : 0));
    const weekTrend = [...byWeek.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-4)
      .map(([, v]) => toPoint(v.label, v.count ? v.sum / v.count : 0));
    const monthTrend = [...byMonth.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-6)
      .map(([, v]) => toPoint(v.label, v.count ? v.sum / v.count : 0));

    return res.json({
      kpis: {
        totalEmployees: Number(totalEmployees || 0),
        avgHappiness,
        departments: Number(departments || 0),
        avgScoreTrend,
      },
      trend: {
        day: dayTrend,
        week: weekTrend,
        month: monthTrend,
      },
      gender: {
        male: {
          employees: Number(maleRow?.employees || 0),
          score: maleRow?.avgScore === null ? 0 : Number(maleRow?.avgScore || 0),
        },
        female: {
          employees: Number(femaleRow?.employees || 0),
          score: femaleRow?.avgScore === null ? 0 : Number(femaleRow?.avgScore || 0),
        },
      },
      departmentsDetails: deptDetails.map((d) => ({
        name: d.name,
        employees: Number(d.employees || 0),
        score: d.avgScore === null ? 0 : Number(d.avgScore || 0),
      })),
    });
  } catch (error) {
    console.error("getAdminPulseOverview error:", error);
    return res.status(500).json({ message: "Failed to load overview" });
  }
};

// Admin: survey responses list
const getAdminPulseSurveyResponses = async (req, res) => {
  if (!requireAuthType(req, res, "admin")) return;

  const companyId = req.user.company_id;
  const { id } = req.params;

  try {
    const survey = await db("pulse_surveys")
      .where({ id: Number(id), company_id: companyId })
      .first();
    if (!survey) return res.status(404).json({ message: "Survey not found" });

    const responses = await db("pulse_survey_responses as r")
      .join("employees as e", "e.id", "r.employee_id")
      .where("r.company_id", companyId)
      .andWhere("r.survey_id", Number(id))
      .orderBy("r.responded_at", "desc")
      .select(
        "r.*",
        "e.first_name",
        "e.last_name",
        "e.email",
        "e.gender",
      );

    return res.json(
      responses.map((r) => ({
        id: r.id,
        surveyId: r.survey_id,
        employeeId: r.employee_id,
        score: r.score,
        label: r.label,
        comment: r.comment || "",
        isAnonymous: Boolean(r.is_anonymous),
        respondedAt: r.responded_at,
        updatedAt: r.updated_at,
        employee: Boolean(r.is_anonymous) || Boolean(survey.allow_anonymous) && Boolean(r.is_anonymous)
          ? null
          : {
              name: `${r.first_name} ${r.last_name || ""}`.trim(),
              email: r.email,
              gender: r.gender,
            },
      })),
    );
  } catch (error) {
    console.error("getAdminPulseSurveyResponses error:", error);
    return res.status(500).json({ message: "Failed to fetch responses" });
  }
};

// Employee: my surveys
const getMyPulseSurveys = async (req, res) => {
  if (!requireAuthType(req, res, "employee")) return;

  const companyId = req.user.company_id;
  const employeeId = req.user.id;

  try {
    const surveys = await db("pulse_survey_recipients as pr")
      .join("pulse_surveys as s", "s.id", "pr.survey_id")
      .leftJoin("pulse_survey_responses as r", function () {
        this.on("r.survey_id", "=", "s.id").andOn(
          "r.employee_id",
          "=",
          db.raw("?", [employeeId]),
        );
      })
      .where("pr.company_id", companyId)
      .andWhere("pr.employee_id", employeeId)
      .orderBy("s.created_at", "desc")
      .select(
        "s.id",
        "s.title",
        "s.message",
        "s.allow_anonymous as allowAnonymous",
        "s.created_at as createdAt",
        "r.score as myScore",
        "r.label as myLabel",
        "r.comment as myComment",
        "r.is_anonymous as myIsAnonymous",
        "r.responded_at as myRespondedAt",
      );

    return res.json(
      surveys.map((s) => ({
        id: s.id,
        title: s.title,
        message: s.message || "",
        allowAnonymous: Boolean(s.allowAnonymous),
        createdAt: s.createdAt,
        myResponse: s.myRespondedAt
          ? {
              score: Number(s.myScore || 0),
              label: s.myLabel || "",
              comment: s.myComment || "",
              isAnonymous: Boolean(s.myIsAnonymous),
              respondedAt: s.myRespondedAt,
            }
          : null,
      })),
    );
  } catch (error) {
    console.error("getMyPulseSurveys error:", error);
    return res.status(500).json({ message: "Failed to fetch surveys" });
  }
};

// Employee: get survey + my response
const getPulseSurveyForEmployee = async (req, res) => {
  if (!requireAuthType(req, res, "employee")) return;

  const companyId = req.user.company_id;
  const employeeId = req.user.id;
  const { id } = req.params;

  try {
    const assigned = await db("pulse_survey_recipients")
      .where({ company_id: companyId, employee_id: employeeId, survey_id: Number(id) })
      .first();
    if (!assigned) return res.status(404).json({ message: "Survey not found" });

    const survey = await db("pulse_surveys")
      .where({ company_id: companyId, id: Number(id) })
      .first();
    if (!survey) return res.status(404).json({ message: "Survey not found" });

    const response = await db("pulse_survey_responses")
      .where({ company_id: companyId, survey_id: Number(id), employee_id: employeeId })
      .first();

    return res.json({
      id: survey.id,
      title: survey.title,
      message: survey.message || "",
      allowAnonymous: Boolean(survey.allow_anonymous),
      createdAt: survey.created_at,
      myResponse: response
        ? {
            score: Number(response.score || 0),
            label: response.label || "",
            comment: response.comment || "",
            isAnonymous: Boolean(response.is_anonymous),
            respondedAt: response.responded_at,
            updatedAt: response.updated_at,
          }
        : null,
    });
  } catch (error) {
    console.error("getPulseSurveyForEmployee error:", error);
    return res.status(500).json({ message: "Failed to fetch survey" });
  }
};

// Employee: submit/update response
const respondPulseSurvey = async (req, res) => {
  if (!requireAuthType(req, res, "employee")) return;

  const companyId = req.user.company_id;
  const employeeId = req.user.id;
  const { id } = req.params;
  const { score, label = "", comment = "", isAnonymous = false } = req.body || {};

  const numericScore = clampScore(score);
  if (numericScore < 1 || numericScore > 10) {
    return res.status(400).json({ message: "Score must be between 1 and 10" });
  }

  try {
    const survey = await db("pulse_surveys")
      .where({ company_id: companyId, id: Number(id) })
      .first();
    if (!survey) return res.status(404).json({ message: "Survey not found" });

    const assigned = await db("pulse_survey_recipients")
      .where({ company_id: companyId, employee_id: employeeId, survey_id: Number(id) })
      .first();
    if (!assigned) return res.status(403).json({ message: "Not allowed" });

    const allowAnonymous = Boolean(survey.allow_anonymous);
    const anonymousFlag = allowAnonymous ? Boolean(isAnonymous) : false;

    const existing = await db("pulse_survey_responses")
      .where({ company_id: companyId, survey_id: Number(id), employee_id: employeeId })
      .first();

    const now = new Date();
    const payload = {
      survey_id: Number(id),
      employee_id: employeeId,
      company_id: companyId,
      score: numericScore,
      label: String(label || "").slice(0, 64),
      comment: comment ? String(comment) : null,
      is_anonymous: anonymousFlag,
      responded_at: now,
      updated_at: now,
    };

    if (existing) {
      await db("pulse_survey_responses")
        .where({ id: existing.id })
        .update(payload);
    } else {
      await db("pulse_survey_responses").insert({
        ...payload,
        created_at: now,
      });
    }

    return res.json({ message: existing ? "Response updated" : "Response submitted" });
  } catch (error) {
    console.error("respondPulseSurvey error:", error);
    return res.status(500).json({ message: "Failed to submit response" });
  }
};

// Admin: templates CRUD
const getPulseSurveyTemplates = async (req, res) => {
  if (!requireAuthType(req, res, "admin")) return;

  const companyId = req.user.company_id;
  const onlyActive = String(req.query.active || "").toLowerCase() === "true";

  try {
    const query = db("pulse_survey_templates")
      .where("company_id", companyId)
      .orderBy("created_at", "desc");

    if (onlyActive) query.andWhere("is_active", 1);

    const templates = await query;
    return res.json(
      templates.map((t) => ({
        id: t.id,
        name: t.name,
        title: t.title,
        message: t.message || "",
        category: t.category || "general",
        isActive: Boolean(t.is_active),
        createdAt: t.created_at,
        updatedAt: t.updated_at,
      })),
    );
  } catch (error) {
    console.error("getPulseSurveyTemplates error:", error);
    return res.status(500).json({ message: "Failed to fetch templates" });
  }
};

const createPulseSurveyTemplate = async (req, res) => {
  if (!requireAuthType(req, res, "admin")) return;

  const companyId = req.user.company_id;
  const createdByUserId = req.user.id;
  const { name, title, message = "", category = "general", isActive = true } = req.body || {};

  if (!name || !String(name).trim()) {
    return res.status(400).json({ message: "Template name is required" });
  }
  if (!title || !String(title).trim()) {
    return res.status(400).json({ message: "Template title is required" });
  }

  try {
    const payload = {
      company_id: companyId,
      created_by_user_id: createdByUserId,
      name: String(name).trim(),
      title: String(title).trim(),
      message: message ? String(message) : null,
      category: String(category || "general").trim() || "general",
      is_active: Boolean(isActive),
      created_at: new Date(),
      updated_at: new Date(),
    };

    const [id] = await db("pulse_survey_templates").insert(payload);
    return res.status(201).json({ id, ...payload, company_id: undefined, created_by_user_id: undefined });
  } catch (error) {
    console.error("createPulseSurveyTemplate error:", error);
    if (error?.code === "ER_DUP_ENTRY") {
      return res.status(400).json({ message: "Template name already exists" });
    }
    return res.status(500).json({ message: "Failed to create template" });
  }
};

const updatePulseSurveyTemplate = async (req, res) => {
  if (!requireAuthType(req, res, "admin")) return;

  const companyId = req.user.company_id;
  const { id } = req.params;
  const { name, title, message, category, isActive } = req.body || {};

  try {
    const existing = await db("pulse_survey_templates")
      .where({ id: Number(id), company_id: companyId })
      .first();
    if (!existing) return res.status(404).json({ message: "Template not found" });

    const next = {
      updated_at: new Date(),
    };
    if (name !== undefined) next.name = String(name).trim();
    if (title !== undefined) next.title = String(title).trim();
    if (message !== undefined) next.message = message ? String(message) : null;
    if (category !== undefined) next.category = String(category || "general").trim() || "general";
    if (isActive !== undefined) next.is_active = Boolean(isActive);

    await db("pulse_survey_templates")
      .where({ id: Number(id), company_id: companyId })
      .update(next);

    return res.json({ message: "Template updated" });
  } catch (error) {
    console.error("updatePulseSurveyTemplate error:", error);
    if (error?.code === "ER_DUP_ENTRY") {
      return res.status(400).json({ message: "Template name already exists" });
    }
    return res.status(500).json({ message: "Failed to update template" });
  }
};

const deletePulseSurveyTemplate = async (req, res) => {
  if (!requireAuthType(req, res, "admin")) return;

  const companyId = req.user.company_id;
  const { id } = req.params;

  try {
    const deleted = await db("pulse_survey_templates")
      .where({ id: Number(id), company_id: companyId })
      .del();

    if (!deleted) return res.status(404).json({ message: "Template not found" });
    return res.json({ message: "Template deleted" });
  } catch (error) {
    console.error("deletePulseSurveyTemplate error:", error);
    return res.status(500).json({ message: "Failed to delete template" });
  }
};

module.exports = {
  createPulseSurvey,
  getAdminPulseSurveys,
  getAdminPulseSurveyById,
  getAdminPulseOverview,
  getAdminPulseSurveyResponses,
  getMyPulseSurveys,
  getPulseSurveyForEmployee,
  respondPulseSurvey,
  // Templates
  createPulseSurveyTemplate,
  getPulseSurveyTemplates,
  updatePulseSurveyTemplate,
  deletePulseSurveyTemplate,
};
