const knex = require("../db/db");
const { normalizeRole, canViewOrganization } = require("../utils/kpiAccess");

const firstExistingTable = async (candidates = []) => {
  for (const tableName of candidates) {
    if (await knex.schema.hasTable(tableName)) return tableName;
  }
  return null;
};

const getColumnInfo = async (tableName) => {
  if (!tableName) return {};
  try {
    return await knex(tableName).columnInfo();
  } catch {
    return {};
  }
};

const firstColumn = (columns = {}, candidates = []) =>
  candidates.find((column) => Boolean(columns[column])) || null;

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const round2 = (value) => Math.round(toNumber(value) * 100) / 100;

const resolveEmployeeScope = async ({
  companyId,
  currentEmployeeId,
  currentRole,
  departmentId,
  requestedDepartmentId,
  requestedEmployeeId,
}) => {
  const employeeTable = await firstExistingTable(["employees", "user"]);
  if (!employeeTable) {
    return {
      employeeTable: null,
      employeeColumns: {},
      employeeIds: [],
      effectiveDepartmentId: null,
      effectiveEmployeeId: null,
    };
  }

  const employeeColumns = await getColumnInfo(employeeTable);
  const idCol = firstColumn(employeeColumns, ["id", "employee_id"]);
  const companyCol = firstColumn(employeeColumns, [
    "company_id",
    "organizationId",
    "organization_id",
  ]);
  const departmentCol = firstColumn(employeeColumns, [
    "department_id",
    "departmentId",
  ]);
  const activeCol = firstColumn(employeeColumns, ["is_active", "isActive", "status"]);

  const canViewOrg = canViewOrganization(currentRole);
  const isManager = currentRole === "MANAGER";
  const effectiveDepartmentId = isManager
    ? departmentId || null
    : canViewOrganization && requestedDepartmentId
      ? requestedDepartmentId
      : null;
  const effectiveEmployeeId =
    requestedEmployeeId && (canViewOrganization || isManager)
      ? requestedEmployeeId
      : !canViewOrganization && !isManager
        ? currentEmployeeId || null
        : null;

  if (!idCol) {
    return {
      employeeTable,
      employeeColumns,
      employeeIds: [],
      effectiveDepartmentId,
      effectiveEmployeeId,
    };
  }

  const query = knex(employeeTable).select(`${employeeTable}.${idCol} as id`);
  if (companyCol && companyId) {
    query.where(`${employeeTable}.${companyCol}`, companyId);
  }
  if (departmentCol && effectiveDepartmentId) {
    query.where(`${employeeTable}.${departmentCol}`, effectiveDepartmentId);
  }
  if (effectiveEmployeeId) {
    query.where(`${employeeTable}.${idCol}`, effectiveEmployeeId);
  }
  if (activeCol) {
    if (activeCol === "status") {
      query.whereNotIn(`${employeeTable}.${activeCol}`, ["Inactive", "inactive"]);
    } else {
      query.where(`${employeeTable}.${activeCol}`, true);
    }
  }

  const rows = await query;
  return {
    employeeTable,
    employeeColumns,
    employeeIds: rows.map((row) => Number(row.id)).filter(Boolean),
    effectiveDepartmentId,
    effectiveEmployeeId,
  };
};

const getEmployeeDisplayNameExpression = (tableName, columns = {}) => {
  if (columns.fullName) return knex.raw("??", [`${tableName}.fullName`]);
  if (columns.full_name) return knex.raw("??", [`${tableName}.full_name`]);
  if (columns.name) return knex.raw("??", [`${tableName}.name`]);
  if (columns.first_name && columns.last_name) {
    return knex.raw(
      "TRIM(CONCAT(COALESCE(??, ''), ' ', COALESCE(??, '')))",
      [`${tableName}.first_name`, `${tableName}.last_name`],
    );
  }
  if (columns.first_name) return knex.raw("??", [`${tableName}.first_name`]);
  if (columns.last_name) return knex.raw("??", [`${tableName}.last_name`]);
  return knex.raw("CAST(?? AS CHAR)", [`${tableName}.id`]);
};

const getAvailableEmployees = async ({
  employeeTable,
  employeeColumns,
  companyId,
  effectiveDepartmentId,
}) => {
  if (!employeeTable) return [];

  const idCol = firstColumn(employeeColumns, ["id", "employee_id"]);
  const companyCol = firstColumn(employeeColumns, [
    "company_id",
    "organizationId",
    "organization_id",
  ]);
  const departmentCol = firstColumn(employeeColumns, [
    "department_id",
    "departmentId",
  ]);
  if (!idCol) return [];

  const departmentTable = await firstExistingTable(["departments", "department"]);
  const departmentColumns = await getColumnInfo(departmentTable);
  const departmentIdCol = firstColumn(departmentColumns, ["id"]);
  const departmentNameCol = firstColumn(departmentColumns, ["name", "department_name"]);

  const query = knex(employeeTable)
    .select(`${employeeTable}.${idCol} as id`)
    .select({ name: getEmployeeDisplayNameExpression(employeeTable, employeeColumns) });

  if (departmentTable && departmentCol && departmentIdCol && departmentNameCol) {
    query
      .leftJoin(
        departmentTable,
        `${employeeTable}.${departmentCol}`,
        `${departmentTable}.${departmentIdCol}`,
      )
      .select(`${departmentTable}.${departmentNameCol} as departmentName`);
  } else {
    query.select(knex.raw("'' as departmentName"));
  }

  if (companyCol && companyId) query.where(`${employeeTable}.${companyCol}`, companyId);
  if (departmentCol && effectiveDepartmentId) {
    query.where(`${employeeTable}.${departmentCol}`, effectiveDepartmentId);
  }

  query.orderBy("name", "asc");
  return query;
};

const getAvailableDepartments = async ({ companyId, canViewOrganization }) => {
  if (!canViewOrganization) return [];

  const departmentTable = await firstExistingTable(["departments", "department"]);
  if (!departmentTable) return [];

  const columns = await getColumnInfo(departmentTable);
  const idCol = firstColumn(columns, ["id"]);
  const nameCol = firstColumn(columns, ["name", "department_name"]);
  const companyCol = firstColumn(columns, [
    "company_id",
    "organizationId",
    "organization_id",
  ]);
  if (!idCol || !nameCol) return [];

  const query = knex(departmentTable)
    .select(`${idCol} as id`, `${nameCol} as name`)
    .orderBy(nameCol, "asc");
  if (companyCol && companyId) query.where(companyCol, companyId);
  return query;
};

const getKpiTemplateData = async ({ employeeIds }) => {
  const templateTable = await firstExistingTable([
    "kpitemplate",
    "kpi_templates",
    "kpi_template",
  ]);
  if (!templateTable) return { templates: [], templateIds: [] };

  const columns = await getColumnInfo(templateTable);
  const idCol = firstColumn(columns, ["id"]);
  const ownerCol = firstColumn(columns, [
    "ownerUserId",
    "owner_user_id",
    "owner_employee_id",
    "employee_id",
    "user_id",
  ]);
  const createdCol = firstColumn(columns, ["createdAt", "created_at", "date"]);
  const titleCol = firstColumn(columns, ["title", "name"]);
  const totalScoreCol = firstColumn(columns, ["totalScore", "total_score", "score"]);
  if (!idCol) return { templates: [], templateIds: [] };

  const query = knex(templateTable).select(`${idCol} as id`);
  if (ownerCol) query.select(`${ownerCol} as ownerId`);
  else query.select(knex.raw("NULL as ownerId"));
  if (createdCol) query.select(`${createdCol} as createdAt`);
  else query.select(knex.raw("NOW() as createdAt"));
  if (titleCol) query.select(`${titleCol} as title`);
  else query.select(knex.raw("NULL as title"));
  if (totalScoreCol) query.select(`${totalScoreCol} as totalScore`);
  else query.select(knex.raw("0 as totalScore"));

  if (ownerCol && employeeIds.length) {
    query.whereIn(ownerCol, employeeIds);
  } else if (ownerCol && !employeeIds.length) {
    query.whereRaw("1 = 0");
  }

  query.orderBy(createdCol || idCol, "desc").orderBy(idCol, "desc");
  const templates = await query;
  const templateIds = templates.map((template) => Number(template.id)).filter(Boolean);

  const parameterTable = await firstExistingTable([
    "kpiparameter",
    "kpi_parameters",
    "kpi_parameter",
  ]);
  if (!parameterTable || !templateIds.length) {
    return { templates: templates.map((template) => ({ ...template, totalScore: round2(template.totalScore) })), templateIds };
  }

  const parameterColumns = await getColumnInfo(parameterTable);
  const templateIdCol = firstColumn(parameterColumns, [
    "kpiTemplateId",
    "kpi_template_id",
    "template_id",
  ]);
  const scoreCol = firstColumn(parameterColumns, ["kpiScore", "kpi_score", "score"]);
  if (!templateIdCol || !scoreCol) {
    return { templates: templates.map((template) => ({ ...template, totalScore: round2(template.totalScore) })), templateIds };
  }

  const scoreRows = await knex(parameterTable)
    .select(`${templateIdCol} as templateId`)
    .sum({ score: scoreCol })
    .whereIn(templateIdCol, templateIds)
    .groupBy(templateIdCol);
  const scoreByTemplate = new Map(
    scoreRows.map((row) => [String(row.templateId), round2(row.score)]),
  );

  return {
    templateIds,
    templates: templates.map((template) => ({
      ...template,
      totalScore: scoreByTemplate.has(String(template.id))
        ? scoreByTemplate.get(String(template.id))
        : round2(template.totalScore),
    })),
  };
};

const getPendingReviews = async ({ templateIds, employeeIds }) => {
  const employeeKpiTable = await firstExistingTable(["employeeKpi", "employee_kpi"]);
  if (employeeKpiTable) {
    const columns = await getColumnInfo(employeeKpiTable);
    const statusCol = firstColumn(columns, ["status"]);
    const employeeCol = firstColumn(columns, ["userId", "user_id", "employee_id"]);
    if (statusCol) {
      const query = knex(employeeKpiTable).count({ count: "*" }).where(statusCol, "PENDING");
      if (employeeCol && employeeIds.length) query.whereIn(employeeCol, employeeIds);
      const row = await query.first();
      return toNumber(row?.count);
    }
  }

  const reviewTable = await firstExistingTable([
    "kpiParameterReview",
    "kpi_parameter_reviews",
    "kpi_parameter_review",
  ]);
  if (!reviewTable) return 0;

  const columns = await getColumnInfo(reviewTable);
  const statusCol = firstColumn(columns, ["status"]);
  const templateIdCol = firstColumn(columns, [
    "kpiTemplateId",
    "kpi_template_id",
    "template_id",
  ]);
  if (!statusCol) return 0;

  const query = knex(reviewTable).count({ count: "*" }).where(statusCol, "PENDING");
  if (templateIdCol && templateIds.length) query.whereIn(templateIdCol, templateIds);
  else if (templateIdCol) query.whereRaw("1 = 0");
  const row = await query.first();
  return toNumber(row?.count);
};

const getCorrectiveActionStatus = async ({ templateIds }) => {
  const reviewTable = await firstExistingTable([
    "kpiParameterReview",
    "kpi_parameter_reviews",
    "kpi_parameter_review",
  ]);
  const correctiveActionStatus = {
    pending: 0,
    inProgress: 0,
    completed: 0,
  };
  if (!reviewTable) return correctiveActionStatus;

  const columns = await getColumnInfo(reviewTable);
  const statusCol = firstColumn(columns, ["status"]);
  const templateIdCol = firstColumn(columns, [
    "kpiTemplateId",
    "kpi_template_id",
    "template_id",
  ]);
  if (!statusCol) return correctiveActionStatus;

  const query = knex(reviewTable)
    .select(`${statusCol} as status`)
    .count({ count: "*" })
    .groupBy(statusCol);
  if (templateIdCol && templateIds.length) query.whereIn(templateIdCol, templateIds);
  else if (templateIdCol) query.whereRaw("1 = 0");

  const rows = await query;
  rows.forEach((row) => {
    if (row.status === "PENDING") correctiveActionStatus.pending = toNumber(row.count);
    if (row.status === "IN_PROGRESS") correctiveActionStatus.inProgress = toNumber(row.count);
    if (row.status === "COMPLETED") correctiveActionStatus.completed = toNumber(row.count);
  });

  return correctiveActionStatus;
};

const getCompetencyGrowthPct = async ({ employeeTable, employeeColumns, employeeIds }) => {
  if (!employeeTable || !employeeIds.length) return 0;
  const competencyCol = firstColumn(employeeColumns, [
    "competencyPct",
    "competency_pct",
    "competency",
  ]);
  const idCol = firstColumn(employeeColumns, ["id", "employee_id"]);
  if (!competencyCol || !idCol) return 0;

  const row = await knex(employeeTable)
    .whereIn(idCol, employeeIds)
    .avg({ avg: competencyCol })
    .first();
  return round2(row?.avg);
};

const getKpiDashboardWidgets = async (req, res) => {
  try {
    const companyId = Number(req.user?.company_id || 0) || null;
    const currentEmployeeId =
      Number(req.user?.employee_id || req.user?.id || 0) || null;
    const currentRole = normalizeRole(req.user?.role);
    const requestedDepartmentId =
      Number.parseInt(String(req.query.departmentId || ""), 10) || null;
    const requestedEmployeeId =
      Number.parseInt(String(req.query.employeeId || ""), 10) || null;

    const currentEmployee = currentEmployeeId
      ? await knex("employees")
          .where({ id: currentEmployeeId })
          .modify((query) => {
            if (companyId) query.where("company_id", companyId);
          })
          .first()
          .catch(() => null)
      : null;

    const canViewOrganization = [
      "ADMIN",
      "CEO",
      "PDHEAD",
      "PILLARS",
      "SUPERADMIN",
    ].includes(currentRole);

    const scope = await resolveEmployeeScope({
      companyId,
      currentEmployeeId,
      currentRole,
      departmentId: currentEmployee?.department_id || null,
      requestedDepartmentId,
      requestedEmployeeId,
    });

    const { templates, templateIds } = await getKpiTemplateData({
      employeeIds: scope.employeeIds,
    });

    const validScorecards = templates
      .map((template) => {
        const monthDate = new Date(template.createdAt);
        return {
          id: template.id,
          monthDate,
          ownerId: Number(template.ownerId || 0),
          ownerName: template.ownerName || template.title || "Unassigned",
          score: round2(template.totalScore),
        };
      })
      .filter((item) => !Number.isNaN(item.monthDate.getTime()));

    const averageKpiScore = validScorecards.length
      ? round2(
          validScorecards.reduce((sum, item) => sum + item.score, 0) /
            validScorecards.length,
        )
      : 0;

    const bestScoreByPerson = new Map();
    validScorecards.forEach((item) => {
      const key = item.ownerId ? String(item.ownerId) : item.ownerName.toLowerCase();
      const existing = bestScoreByPerson.get(key);
      if (!existing || item.score > existing.score) bestScoreByPerson.set(key, item);
    });

    const topPerformers = Array.from(bestScoreByPerson.values())
      .sort((a, b) => b.score - a.score || a.ownerName.localeCompare(b.ownerName))
      .slice(0, 5)
      .map((item) => ({
        id: item.ownerId,
        name: item.ownerName,
        score: item.score,
      }));

    const monthGroups = new Map();
    validScorecards.forEach((item) => {
      const monthKey = `${item.monthDate.getUTCFullYear()}-${String(
        item.monthDate.getUTCMonth() + 1,
      ).padStart(2, "0")}`;
      const monthLabel = new Intl.DateTimeFormat("en-US", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }).format(item.monthDate);
      const performer = { id: item.ownerId, name: item.ownerName, score: item.score };
      const group = monthGroups.get(monthKey) || {
        month: monthKey,
        monthLabel,
        performers: [],
      };
      const performerKey = performer.id ? String(performer.id) : performer.name.toLowerCase();
      const existingIndex = group.performers.findIndex((candidate) => {
        const candidateKey = candidate.id ? String(candidate.id) : candidate.name.toLowerCase();
        return candidateKey === performerKey;
      });
      if (existingIndex >= 0) {
        if (performer.score > group.performers[existingIndex].score) {
          group.performers[existingIndex] = performer;
        }
      } else {
        group.performers.push(performer);
      }
      monthGroups.set(monthKey, group);
    });

    const monthlyTopPerformers = Array.from(monthGroups.values()).map((group) => ({
      ...group,
      performers: group.performers
        .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
        .slice(0, 5),
    }));

    const [
      pendingReviews,
      correctiveActionStatus,
      competencyGrowthPct,
      availableDepartments,
      availableEmployees,
    ] = await Promise.all([
      getPendingReviews({ templateIds, employeeIds: scope.employeeIds }),
      getCorrectiveActionStatus({ templateIds }),
      getCompetencyGrowthPct({
        employeeTable: scope.employeeTable,
        employeeColumns: scope.employeeColumns,
        employeeIds: scope.employeeIds,
      }),
      getAvailableDepartments({ companyId, canViewOrganization }),
      getAvailableEmployees({
        employeeTable: scope.employeeTable,
        employeeColumns: scope.employeeColumns,
        companyId,
        effectiveDepartmentId: scope.effectiveDepartmentId,
      }),
    ]);

    const correctiveActionTotal =
      correctiveActionStatus.pending +
      correctiveActionStatus.inProgress +
      correctiveActionStatus.completed;

    return res.json({
      totalEmployees: scope.employeeIds.length,
      averageKpiScore,
      pendingReviews,
      topPerformers,
      topPerformerCount: topPerformers.filter((item) => item.score >= 70).length,
      monthlyTopPerformers,
      lowKpiAlerts: validScorecards.filter((item) => item.score < 70).length,
      kpiTrend: [],
      competencyGrowthPct,
      correctiveActionStatus,
      correctiveActionTotal,
      availableDepartments,
      availableEmployees,
    });
  } catch (error) {
    console.error("KPI dashboard widgets error:", error);
    return res.status(500).json({
      message: "Failed to fetch KPI dashboard widgets",
    });
  }
};

module.exports = {
  getKpiDashboardWidgets,
};
