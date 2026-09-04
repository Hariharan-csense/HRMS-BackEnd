const knex = require("../db/db");
const fs = require("fs");
const path = require("path");
const {
  normalizeRole,
  canViewOrganization,
  getCurrentEmployeeId,
  getKpiVisibilityScope,
} = require("../utils/kpiAccess");
const { sendPushToUsers } = require("../services/pushNotificationService");

const monthLabelToNumber = {
  January: 1,
  February: 2,
  March: 3,
  April: 4,
  May: 5,
  June: 6,
  July: 7,
  August: 8,
  September: 9,
  October: 10,
  November: 11,
  December: 12,
};

const toNumber = (value, fallback = null) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseOptionalNumber = (value, fallback = null) => {
  if (value === null || value === undefined) return fallback;
  const raw = String(value).trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const hasDailyAchievementData = (row) => {
  const daily = normalizeDailyAchievements(row.dailyAchievements);
  return Object.values(daily).some((entry) => {
    if (entry && typeof entry === "object") {
      return Object.values(entry).some(
        (value) => String(value ?? "").trim() !== "",
      );
    }
    return String(entry ?? "").trim() !== "";
  });
};

const hasAchievementInput = (row) => {
  const raw = String(row.achievement ?? "").trim();
  if (!raw) return false;
  if (hasDailyAchievementData(row)) return true;
  return Number(raw) !== 0;
};

const formatDecimalValue = (value) => {
  if (value == null || value === "") return "";
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return String(value);
  return Number.isInteger(parsed) ? String(parsed) : String(parsed);
};

const normalizeDailyAchievements = (value) => {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed
        : {};
    } catch {
      return {};
    }
  }
  return {};
};

const serializeDailyAchievements = (value) => {
  const normalized = normalizeDailyAchievements(value);
  return JSON.stringify(normalized);
};

const parseLeadIndicatorDefinitions = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return [];

  if (raw.startsWith("[") || raw.startsWith("{")) {
    try {
      const parsed = JSON.parse(raw);
      const items = Array.isArray(parsed) ? parsed : parsed?.items;
      if (Array.isArray(items)) {
        return items
          .map((item) => ({
            label: String(item?.label || "").trim(),
            type: item?.type === "yesno" ? "yesno" : "number",
            targetValue: String(item?.targetValue ?? item?.target ?? "").trim(),
            minimumValue: String(item?.minimumValue ?? item?.minimum ?? "").trim(),
            assignedEmployeeId:
              Number(item?.assignedEmployeeId || item?.assigned_employee_id || 0) ||
              null,
          }))
          .filter((item) => item.label);
      }
    } catch {
      // Fall back to legacy text parsing.
    }
  }

  return raw
    .replace(/(\d+\.\d+)\s+/g, "\n$1 ")
    .replace(/[;|]+/g, ",")
    .split(/\r?\n|,/)
    .map((item) => item.trim().replace(/^\d+\.\d+\s*/, ""))
    .filter(Boolean)
    .map((label) => ({
      label,
      type: "number",
      targetValue: "",
      minimumValue: "",
      assignedEmployeeId: null,
    }));
};

const evaluateLeadIndicatorStatus = (indicator, value) => {
  const raw = String(value ?? "").trim();
  if (!raw) return "missing";
  if (indicator.type === "yesno") {
    const normalized = raw.toLowerCase();
    if (["yes", "y", "true", "1"].includes(normalized)) return "green";
    if (["no", "n", "false", "0"].includes(normalized)) return "red";
    return "yellow";
  }

  const numericValue = parseOptionalNumber(raw);
  const target = parseOptionalNumber(indicator.targetValue);
  const minimum = parseOptionalNumber(indicator.minimumValue);
  if (numericValue === null) return "yellow";
  if (minimum !== null && numericValue < minimum) return "red";
  if (target !== null && numericValue < target) return "yellow";
  return "green";
};

const getAssignedLeadIndicatorKeys = (parameters = []) => {
  const keys = new Set();
  parameters.forEach((parameter) => {
    parseLeadIndicatorDefinitions(parameter.leadIndicators).forEach(
      (indicator, index) => {
        if (indicator.assignedEmployeeId) {
          keys.add(
            `${Number(parameter.id)}:${index}:${Number(indicator.assignedEmployeeId)}`,
          );
        }
      },
    );
  });
  return keys;
};

const createLeadIndicatorNotifications = async ({
  companyId,
  parameters = [],
  previousKeys = new Set(),
}) => {
  const notifications = [];

  parameters.forEach((parameter) => {
    parseLeadIndicatorDefinitions(parameter.leadIndicators).forEach(
      (indicator, index) => {
        const employeeId = Number(indicator.assignedEmployeeId || 0);
        if (!employeeId) return;

        const key = `${Number(parameter.id)}:${index}:${employeeId}`;
        if (previousKeys.has(key)) return;

        notifications.push({
          user_id: String(employeeId),
          company_id: companyId,
          title: "KPI Lead Indicator Assigned",
          description: `You have been assigned "${indicator.label}" for ${parameter.parameter || parameter.name || "KPI Parameter"}.`,
          type: "info",
          module_id: "kpi",
          action_url: "/dashboard",
          read: false,
          created_at: new Date(),
        });
      },
    );
  });

  if (!notifications.length) return { sent: 0, skipped: 0 };

  try {
    await knex("notifications").insert(notifications);
  } catch (error) {
    console.warn("[KPI lead indicator] in-app notification failed:", error);
  }

  try {
    const uniqueEmployeeIds = [
      ...new Set(notifications.map((item) => item.user_id).filter(Boolean)),
    ];
    const push = await sendPushToUsers({
      userIds: uniqueEmployeeIds,
      companyId,
      title: "KPI Lead Indicator Assigned",
      body: "A KPI lead indicator has been assigned to you. Please update today's value.",
      data: {
        moduleId: "kpi",
        actionUrl: "/dashboard",
        companyId,
      },
    });
    return { sent: notifications.length, push };
  } catch (error) {
    console.warn("[KPI lead indicator] push notification failed:", error);
    return { sent: notifications.length, pushFailed: true };
  }
};

const ownerNameExpr = () =>
  knex.raw(
    "TRIM(CONCAT(COALESCE(e.first_name,''), ' ', COALESCE(e.last_name,'')))",
  );

const computeKpiScore = (row) => {
  if (!hasAchievementInput(row)) return 0;

  const reference = toNumber(row.reference);
  const commitment = toNumber(row.commitment);
  const weightage = toNumber(row.weightage);
  const achievement = parseOptionalNumber(row.achievement);

  if (
    reference === null ||
    commitment === null ||
    weightage === null ||
    achievement === null
  ) {
    return 0;
  }

  const denominator = commitment - reference;
  if (denominator === 0) return 0;

  const rawScore = (weightage / denominator) * (achievement - reference);
  const bounded = Math.max(0, Math.min(weightage * 2, rawScore));
  return Number(bounded.toFixed(2));
};

const mapTemplateRows = (templates, parameterMap) =>
  templates.map((template) => {
    const createdAt = template.createdAt
      ? new Date(template.createdAt)
      : new Date();
    const rows = (parameterMap.get(Number(template.id)) || []).map(
      (parameter) => ({
        id: String(parameter.id),
        parameter: parameter.parameter || "",
        uom: parameter.uom || "",
        reference: formatDecimalValue(parameter.reference),
        commitment: formatDecimalValue(parameter.commitment),
        weightage: formatDecimalValue(parameter.weightage),
        achievement: formatDecimalValue(parameter.achievement),
        dailyAchievements: normalizeDailyAchievements(
          parameter.dailyAchievements,
        ),
        definition: parameter.definition || "",
        measurement: parameter.measurement || "",
        dataSource: parameter.dataSource || "",
        leadIndicators: parameter.leadIndicators || "",
      attachmentPath: parameter.attachmentPath || "",
      attachmentName: parameter.attachmentName || "",
      attachmentUploadedByName: parameter.attachmentUploadedByName || "",
      attachmentUploadedAt: parameter.attachmentUploadedAt
        ? new Date(parameter.attachmentUploadedAt).toISOString()
        : "",
      }),
    );

    return {
      id: String(template.id),
      userId: String(template.userId || ""),
      userName: template.userName || "Employee",
      year: createdAt.getFullYear(),
      month: createdAt.getMonth() + 1,
      frequency: template.frequency || "MONTHLY",
      rows,
      totalScore: Number(template.totalScore || 0),
    };
  });

exports.getScorecards = async (req, res) => {
  try {
    const companyId = req.user?.company_id || null;
    const role = normalizeRole(req.user?.role);
    const selectedUserId = String(req.query.userId || "").trim();
    const selectedUserIdNumber = toNumber(selectedUserId);
    const selectedYear = String(req.query.year || "").trim();
    const selectedMonth = String(req.query.month || "").trim();

    const query = knex("kpi_templates as t")
      .leftJoin("employees as e", "t.owner_employee_id", "e.id")
      .select("t.id as id")
      .select("t.owner_employee_id as userId")
      .select("t.frequency as frequency")
      .select("t.total_score as totalScore")
      .select("t.created_at as createdAt")
      .select({ userName: ownerNameExpr() })
      .orderBy("t.created_at", "desc")
      .orderBy("t.id", "desc");

    if (companyId) query.where("t.company_id", companyId);

    const scope = getKpiVisibilityScope(req.user);
    const currentEmployeeId = getCurrentEmployeeId(req.user);
    const currentDepartmentId = Number(req.user?.department_id || 0) || null;

    if (scope === "self") {
      if (currentEmployeeId)
        query.where("t.owner_employee_id", currentEmployeeId);
    } else if (scope === "department") {
      if (currentDepartmentId)
        query.where("t.department_id", currentDepartmentId);
      if (selectedUserIdNumber)
        query.where("t.owner_employee_id", selectedUserIdNumber);
    } else if (selectedUserIdNumber) {
      query.where("t.owner_employee_id", selectedUserIdNumber);
    }

    const templates = await query;
    const templateIds = templates
      .map((item) => Number(item.id))
      .filter(Boolean);

    const parameters = templateIds.length
      ? await knex("kpi_parameters")
          .whereIn("kpi_template_id", templateIds)
          .select("id")
          .select("kpi_template_id as templateId")
          .select("name as parameter")
          .select("uom")
          .select("reference")
          .select("commitment")
          .select("weightage")
          .select("achievement")
          .select("daily_achievements as dailyAchievements")
          .select("kpi_definition as definition")
          .select("measurement_method as measurement")
          .select("data_source as dataSource")
          .select("lead_indicators as leadIndicators")
          .select("attachment_path as attachmentPath")
          .select("attachment_name as attachmentName")
          .select("attachment_uploaded_by_name as attachmentUploadedByName")
          .select("attachment_uploaded_at as attachmentUploadedAt")
          .orderBy("kpi_template_id", "desc")
          .orderBy("id", "asc")
      : [];

    const parameterMap = new Map();
    parameters.forEach((parameter) => {
      const key = Number(parameter.templateId);
      if (!parameterMap.has(key)) parameterMap.set(key, []);
      parameterMap.get(key).push(parameter);
    });

    const payload = mapTemplateRows(templates, parameterMap).filter(
      (scorecard) => {
        const matchesYear =
          !selectedYear || String(scorecard.year) === selectedYear;
        const matchesMonth =
          !selectedMonth || String(scorecard.month) === selectedMonth;
        return matchesYear && matchesMonth;
      },
    );

    return res.json(payload);
  } catch (error) {
    console.error("KPI scorecards load error:", error);
    return res.status(500).json({ message: "Unable to load KPI scorecards." });
  }
};

exports.createScorecard = async (req, res) => {
  try {
    const companyId = req.user?.company_id || null;
    if (!companyId) {
      return res.status(400).json({ message: "Company context missing." });
    }

    const {
      userId,
      frequency = "MONTHLY",
      totalWeight = 100,
      rows = [],
      year,
      month,
    } = req.body || {};

    const ownerEmployeeId = Number(userId);
    if (!Number.isFinite(ownerEmployeeId) || ownerEmployeeId <= 0) {
      return res.status(400).json({ message: "User is required." });
    }

    const cleanRows = Array.isArray(rows)
      ? rows.filter((row) => String(row?.parameter || "").trim())
      : [];
    if (!cleanRows.length) {
      return res
        .status(400)
        .json({ message: "At least one KPI row is required." });
    }

    const employee = await knex("employees")
      .where({ id: ownerEmployeeId, company_id: companyId })
      .first("id", "department_id", "designation_id");
    if (!employee) {
      return res.status(404).json({ message: "Selected employee not found." });
    }

    const totalScore = Number(
      cleanRows.reduce((sum, row) => sum + computeKpiScore(row), 0).toFixed(2),
    );

    const [templateId] = await knex("kpi_templates").insert({
      company_id: companyId,
      owner_employee_id: ownerEmployeeId,
      department_id: employee.department_id || null,
      designation_id: employee.designation_id || null,
      frequency: String(frequency).toUpperCase(),
      weight: toNumber(totalWeight, 100) ?? 100,
      total_score: totalScore,
      title: "KPI Scorecard",
      created_at:
        year && month
          ? new Date(Number(year), Number(month) - 1, 1)
          : knex.fn.now(),
      updated_at: knex.fn.now(),
    });

    await knex("kpi_parameters").insert(
      cleanRows.map((row) => ({
        kpi_template_id: templateId,
        name: String(row.parameter || "").trim(),
        uom: String(row.uom || "").trim() || null,
        reference: toNumber(row.reference),
        commitment: toNumber(row.commitment),
        weightage: toNumber(row.weightage),
        achievement: parseOptionalNumber(row.achievement),
        kpi_score: computeKpiScore(row),
        daily_achievements: serializeDailyAchievements(row.dailyAchievements),
        kpi_definition: String(row.definition || "").trim() || null,
        measurement_method: String(row.measurement || "").trim() || null,
        data_source: String(row.dataSource || "").trim() || null,
        lead_indicators: String(row.leadIndicators || "").trim() || null,
        created_at: knex.fn.now(),
        updated_at: knex.fn.now(),
      })),
    );

    const createdParameters = await knex("kpi_parameters")
      .where({ kpi_template_id: templateId })
      .select("id")
      .select("name as parameter")
      .select("lead_indicators as leadIndicators")
      .orderBy("id", "asc");

    if (createdParameters.length) {
      await knex("kpi_parameter_reviews").insert(
        createdParameters.map((parameter) => ({
          kpi_template_id: templateId,
          kpi_parameter_id: parameter.id,
          reviewer_employee_id: req.user?.employee_id || req.user?.id || null,
          feedback: null,
          target_date: null,
          status: "PENDING",
          created_at: knex.fn.now(),
          updated_at: knex.fn.now(),
        })),
      );
    }

    await createLeadIndicatorNotifications({
      companyId,
      parameters: createdParameters,
    });

    const template = await knex("kpi_templates as t")
      .leftJoin("employees as e", "t.owner_employee_id", "e.id")
      .where("t.id", templateId)
      .select("t.id as id")
      .select("t.owner_employee_id as userId")
      .select("t.frequency as frequency")
      .select("t.total_score as totalScore")
      .select("t.created_at as createdAt")
      .select({ userName: ownerNameExpr() })
      .first();

    const parameters = await knex("kpi_parameters")
      .where({ kpi_template_id: templateId })
      .select("id")
      .select("kpi_template_id as templateId")
      .select("name as parameter")
      .select("uom")
      .select("reference")
      .select("commitment")
      .select("weightage")
      .select("achievement")
      .select("daily_achievements as dailyAchievements")
      .select("kpi_definition as definition")
      .select("measurement_method as measurement")
      .select("data_source as dataSource")
      .select("lead_indicators as leadIndicators")
      .select("attachment_path as attachmentPath")
      .select("attachment_name as attachmentName")
      .select("attachment_uploaded_by_name as attachmentUploadedByName")
      .select("attachment_uploaded_at as attachmentUploadedAt")
      .orderBy("id", "asc");

    const payload = mapTemplateRows(
      [template],
      new Map([[Number(templateId), parameters]]),
    )[0];

    return res.status(201).json(payload);
  } catch (error) {
    console.error("KPI scorecard create error:", error);
    return res.status(500).json({ message: "Unable to create KPI scorecard." });
  }
};

exports.updateScorecard = async (req, res) => {
  try {
    const companyId = req.user?.company_id || null;
    if (!companyId) {
      return res.status(400).json({ message: "Company context missing." });
    }

    const templateId = toNumber(req.params.id);
    if (!templateId) {
      return res.status(400).json({ message: "Scorecard id is required." });
    }

    const { rows = [], frequency, totalWeight } = req.body || {};
    const cleanRows = Array.isArray(rows)
      ? rows.filter((row) => String(row?.parameter || "").trim())
      : [];
    if (!cleanRows.length) {
      return res
        .status(400)
        .json({ message: "At least one KPI row is required." });
    }

    const existingTemplate = await knex("kpi_templates")
      .where({ id: templateId, company_id: companyId })
      .first("id", "owner_employee_id");
    if (!existingTemplate) {
      return res.status(404).json({ message: "Scorecard not found." });
    }

    const previousParameters = await knex("kpi_parameters")
      .where({ kpi_template_id: templateId })
      .select("id")
      .select("lead_indicators as leadIndicators");
    const previousAssignmentKeys =
      getAssignedLeadIndicatorKeys(previousParameters);

    const totalScore = Number(
      cleanRows.reduce((sum, row) => sum + computeKpiScore(row), 0).toFixed(2),
    );

    await knex.transaction(async (trx) => {
      const templateUpdate = {
        weight: toNumber(totalWeight, 100) ?? 100,
        total_score: totalScore,
        updated_at: trx.fn.now(),
      };
      if (frequency) templateUpdate.frequency = String(frequency).toUpperCase();
      await trx("kpi_templates")
        .where({ id: templateId })
        .update(templateUpdate);

      const existingParameters = await trx("kpi_parameters")
        .where({ kpi_template_id: templateId })
        .select("id");
      const existingIds = new Set(
        existingParameters.map((row) => Number(row.id)),
      );
      const submittedIds = new Set();

      for (const row of cleanRows) {
        const rowId = toNumber(row.id);
        const payload = {
          name: String(row.parameter || "").trim(),
          uom: String(row.uom || "").trim() || null,
          reference: toNumber(row.reference),
          commitment: toNumber(row.commitment),
          weightage: toNumber(row.weightage),
          achievement: parseOptionalNumber(row.achievement),
          kpi_score: computeKpiScore(row),
          daily_achievements: serializeDailyAchievements(row.dailyAchievements),
          kpi_definition: String(row.definition || "").trim() || null,
          measurement_method: String(row.measurement || "").trim() || null,
          data_source: String(row.dataSource || "").trim() || null,
          lead_indicators: String(row.leadIndicators || "").trim() || null,
          updated_at: trx.fn.now(),
        };

        if (rowId && existingIds.has(rowId)) {
          submittedIds.add(rowId);
          await trx("kpi_parameters")
            .where({ id: rowId, kpi_template_id: templateId })
            .update(payload);
        } else {
          const [newParameterId] = await trx("kpi_parameters").insert({
            ...payload,
            kpi_template_id: templateId,
            created_at: trx.fn.now(),
          });
          submittedIds.add(Number(newParameterId));
          await trx("kpi_parameter_reviews").insert({
            kpi_template_id: templateId,
            kpi_parameter_id: newParameterId,
            reviewer_employee_id: req.user?.employee_id || req.user?.id || null,
            feedback: null,
            target_date: null,
            status: "PENDING",
            created_at: trx.fn.now(),
            updated_at: trx.fn.now(),
          });
        }
      }

      const idsToDelete = [...existingIds].filter(
        (id) => !submittedIds.has(id),
      );
      if (idsToDelete.length) {
        await trx("kpi_parameter_reviews")
          .whereIn("kpi_parameter_id", idsToDelete)
          .del();
        await trx("kpi_parameters").whereIn("id", idsToDelete).del();
      }
    });

    const finalAssignmentParameters = await knex("kpi_parameters")
      .where({ kpi_template_id: templateId })
      .select("id")
      .select("name as parameter")
      .select("lead_indicators as leadIndicators")
      .orderBy("id", "asc");

    await createLeadIndicatorNotifications({
      companyId,
      parameters: finalAssignmentParameters,
      previousKeys: previousAssignmentKeys,
    });

    const template = await knex("kpi_templates as t")
      .leftJoin("employees as e", "t.owner_employee_id", "e.id")
      .where("t.id", templateId)
      .select("t.id as id")
      .select("t.owner_employee_id as userId")
      .select("t.frequency as frequency")
      .select("t.total_score as totalScore")
      .select("t.created_at as createdAt")
      .select({ userName: ownerNameExpr() })
      .first();

    const parameters = await knex("kpi_parameters")
      .where({ kpi_template_id: templateId })
      .select("id")
      .select("kpi_template_id as templateId")
      .select("name as parameter")
      .select("uom")
      .select("reference")
      .select("commitment")
      .select("weightage")
      .select("achievement")
      .select("daily_achievements as dailyAchievements")
      .select("kpi_definition as definition")
      .select("measurement_method as measurement")
      .select("data_source as dataSource")
      .select("lead_indicators as leadIndicators")
      .select("attachment_path as attachmentPath")
      .select("attachment_name as attachmentName")
      .select("attachment_uploaded_by_name as attachmentUploadedByName")
      .select("attachment_uploaded_at as attachmentUploadedAt")
      .orderBy("id", "asc");

    const payload = mapTemplateRows(
      [template],
      new Map([[Number(templateId), parameters]]),
    )[0];

    return res.json(payload);
  } catch (error) {
    console.error("KPI scorecard update error:", error);
    return res.status(500).json({ message: "Unable to update KPI scorecard." });
  }
};

exports.getAssignedLeadIndicators = async (req, res) => {
  try {
    const companyId = req.user?.company_id || null;
    const employeeId = getCurrentEmployeeId(req.user);

    if (!companyId || !employeeId) {
      return res.status(400).json({ message: "Employee context missing." });
    }

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    const todayKey = String(now.getDate());

    const rows = await knex("kpi_parameters as p")
      .join("kpi_templates as t", "p.kpi_template_id", "t.id")
      .leftJoin("employees as owner", "t.owner_employee_id", "owner.id")
      .where("t.company_id", companyId)
      .whereRaw("YEAR(t.created_at) = ? AND MONTH(t.created_at) = ?", [
        currentYear,
        currentMonth,
      ])
      .select("p.id as parameterId")
      .select("p.kpi_template_id as scorecardId")
      .select("p.name as parameterName")
      .select("p.uom")
      .select("p.lead_indicators as leadIndicators")
      .select("p.daily_achievements as dailyAchievements")
      .select("t.created_at as periodDate")
      .select({
        scorecardOwner: knex.raw(
          "TRIM(CONCAT(COALESCE(owner.first_name,''), ' ', COALESCE(owner.last_name,'')))",
        ),
      })
      .orderBy("t.created_at", "desc")
      .orderBy("p.id", "asc");

    const assignments = [];
    rows.forEach((row) => {
      const daily = normalizeDailyAchievements(row.dailyAchievements);
      parseLeadIndicatorDefinitions(row.leadIndicators).forEach(
        (indicator, index) => {
          if (Number(indicator.assignedEmployeeId) !== Number(employeeId)) {
            return;
          }

          const rowKey = `li-${index}`;
          const values = daily[rowKey] || {};
          const todayValue = String(values?.[todayKey] || "");
          assignments.push({
            parameterId: String(row.parameterId),
            scorecardId: String(row.scorecardId),
            parameterName: row.parameterName || "KPI Parameter",
            scorecardOwner: row.scorecardOwner || "Employee",
            uom: row.uom || "",
            indicatorIndex: index,
            indicatorLabel: indicator.label,
            type: indicator.type,
            targetValue: indicator.targetValue,
            minimumValue: indicator.minimumValue,
            values,
            todayKey,
            todayValue,
            status: evaluateLeadIndicatorStatus(indicator, todayValue),
            periodDate: row.periodDate,
          });
        },
      );
    });

    return res.json(assignments);
  } catch (error) {
    console.error("Assigned KPI lead indicators load error:", error);
    return res
      .status(500)
      .json({ message: "Unable to load assigned KPI lead indicators." });
  }
};

exports.updateAssignedLeadIndicator = async (req, res) => {
  try {
    const companyId = req.user?.company_id || null;
    const employeeId = getCurrentEmployeeId(req.user);
    const parameterId = toNumber(req.params.parameterId);
    const indicatorIndex = toNumber(req.params.indicatorIndex);

    if (!companyId || !employeeId) {
      return res.status(400).json({ message: "Employee context missing." });
    }
    if (!parameterId || indicatorIndex === null || indicatorIndex < 0) {
      return res.status(400).json({ message: "Indicator id is required." });
    }

    const dayKey = String(req.body?.dayKey || new Date().getDate()).trim();
    const value = String(req.body?.value ?? "").trim();
    const submittedValues =
      req.body?.values && typeof req.body.values === "object"
        ? req.body.values
        : null;

    const parameter = await knex("kpi_parameters as p")
      .join("kpi_templates as t", "p.kpi_template_id", "t.id")
      .where("t.company_id", companyId)
      .andWhere("p.id", parameterId)
      .select("p.id")
      .select("p.lead_indicators as leadIndicators")
      .select("p.daily_achievements as dailyAchievements")
      .first();

    if (!parameter) {
      return res.status(404).json({ message: "KPI parameter not found." });
    }

    const indicator = parseLeadIndicatorDefinitions(parameter.leadIndicators)[
      indicatorIndex
    ];
    if (
      !indicator ||
      Number(indicator.assignedEmployeeId) !== Number(employeeId)
    ) {
      return res.status(403).json({ message: "This lead indicator is not assigned to you." });
    }

    const daily = normalizeDailyAchievements(parameter.dailyAchievements);
    const rowKey = `li-${indicatorIndex}`;
    daily[rowKey] = submittedValues
      ? Object.fromEntries(
          Object.entries(submittedValues).map(([key, entryValue]) => [
            String(key),
            String(entryValue ?? "").trim(),
          ]),
        )
      : {
          ...(daily[rowKey] || {}),
          [dayKey]: value,
        };

    await knex("kpi_parameters")
      .where({ id: parameterId })
      .update({
        daily_achievements: JSON.stringify(daily),
        updated_at: knex.fn.now(),
      });

    return res.json({
      parameterId: String(parameterId),
      indicatorIndex,
      dayKey,
      value: daily[rowKey]?.[dayKey] || value,
      values: daily[rowKey],
    });
  } catch (error) {
    console.error("Assigned KPI lead indicator update error:", error);
    return res
      .status(500)
      .json({ message: "Unable to update assigned KPI lead indicator." });
  }
};

const resolveUploadAbsolutePath = (storedPath) => {
  if (!storedPath) return null;
  const relativePath = String(storedPath).replace(/^\/+/, "");
  const candidates = [
    path.resolve(__dirname, "..", "..", relativePath),
    path.resolve(__dirname, "..", relativePath),
  ];
  return candidates.find(
    (filePath) => fs.existsSync(filePath) && fs.statSync(filePath).isFile(),
  );
};

const canAccessScorecardParameter = async (req, parameterRow) => {
  const companyId = req.user?.company_id || null;
  if (!companyId) return false;

  const template = await knex("kpi_templates")
    .where({ id: parameterRow.kpi_template_id, company_id: companyId })
    .first("id", "owner_employee_id", "department_id");
  if (!template) return false;

  const scope = getKpiVisibilityScope(req.user);
  const currentEmployeeId = getCurrentEmployeeId(req.user);
  const currentDepartmentId = Number(req.user?.department_id || 0) || null;

  if (scope === "self") {
    return Number(template.owner_employee_id) === Number(currentEmployeeId);
  }
  if (scope === "department") {
    return Number(template.department_id) === Number(currentDepartmentId);
  }
  return true;
};

const resolveUploaderLabel = (user) => {
  const name =
    String(user?.name || user?.fullName || "").trim() ||
    `${String(user?.first_name || "").trim()} ${String(user?.last_name || "").trim()}`.trim() ||
    String(user?.email || "").trim() ||
    "User";
  const role = String(user?.role || user?.designation || "").trim();
  return role ? `${name} (${role})` : name;
};

exports.uploadParameterAttachment = async (req, res) => {
  try {
    const companyId = req.user?.company_id || null;
    if (!companyId) {
      return res.status(400).json({ message: "Company context missing." });
    }

    const parameterId = toNumber(req.params.parameterId);
    if (!parameterId) {
      return res.status(400).json({ message: "Parameter id is required." });
    }

    if (!req.file) {
      return res.status(400).json({ message: "Attachment file is required." });
    }

    const parameter = await knex("kpi_parameters")
      .where({ id: parameterId })
      .first("id", "kpi_template_id", "attachment_path");

    if (!parameter) {
      return res.status(404).json({ message: "KPI parameter not found." });
    }

    const canAccess = await canAccessScorecardParameter(req, parameter);
    if (!canAccess) {
      return res.status(403).json({ message: "Access denied." });
    }

    const relativePath = `/uploads/kpi-attachments/company_${companyId}/${req.file.filename}`;
    const previousPath = resolveUploadAbsolutePath(parameter.attachment_path);

    const uploadedByName = resolveUploaderLabel(req.user);
    const uploadedAt = new Date();

    await knex("kpi_parameters").where({ id: parameterId }).update({
      attachment_path: relativePath,
      attachment_name: req.file.originalname,
      attachment_uploaded_by_name: uploadedByName,
      attachment_uploaded_at: uploadedAt,
      updated_at: knex.fn.now(),
    });

    if (previousPath) {
      fs.unlink(previousPath, () => {});
    }

    return res.json({
      id: String(parameterId),
      attachmentPath: relativePath,
      attachmentName: req.file.originalname,
      attachmentUrl: relativePath,
      attachmentUploadedByName: uploadedByName,
      attachmentUploadedAt: uploadedAt.toISOString(),
    });
  } catch (error) {
    console.error("KPI parameter attachment upload error:", error);
    return res.status(500).json({ message: "Unable to upload attachment." });
  }
};

exports.deleteParameterAttachment = async (req, res) => {
  try {
    const companyId = req.user?.company_id || null;
    if (!companyId) {
      return res.status(400).json({ message: "Company context missing." });
    }

    const parameterId = toNumber(req.params.parameterId);
    if (!parameterId) {
      return res.status(400).json({ message: "Parameter id is required." });
    }

    const parameter = await knex("kpi_parameters")
      .where({ id: parameterId })
      .first("id", "kpi_template_id", "attachment_path");

    if (!parameter) {
      return res.status(404).json({ message: "KPI parameter not found." });
    }

    const canAccess = await canAccessScorecardParameter(req, parameter);
    if (!canAccess) {
      return res.status(403).json({ message: "Access denied." });
    }

    const previousPath = resolveUploadAbsolutePath(parameter.attachment_path);

    await knex("kpi_parameters").where({ id: parameterId }).update({
      attachment_path: null,
      attachment_name: null,
      attachment_uploaded_by_name: null,
      attachment_uploaded_at: null,
      updated_at: knex.fn.now(),
    });

    if (previousPath) {
      fs.unlink(previousPath, () => {});
    }

    return res.json({ success: true, id: String(parameterId) });
  } catch (error) {
    console.error("KPI parameter attachment delete error:", error);
    return res.status(500).json({ message: "Unable to remove attachment." });
  }
};
