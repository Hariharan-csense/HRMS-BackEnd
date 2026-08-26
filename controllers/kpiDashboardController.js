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

const parseNumber = (value) => {
  const raw = String(value ?? "").replace(/,/g, "").trim();
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseJsonValue = (value, fallback) => {
  if (value && typeof value === "object") return value;
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
};

const legacyLeadIndicatorLines = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return [];
  return raw
    .replace(/(\d+\.\d+)\s+/g, "\n$1 ")
    .replace(/[;|]+/g, ",")
    .split(/\r?\n|,/)
    .map((item) => item.trim().replace(/^\d+\.\d+\s*/, "").trim())
    .filter(Boolean);
};

const parseLeadIndicatorDefinitions = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return [];

  if (raw.startsWith("[") || raw.startsWith("{")) {
    const parsed = parseJsonValue(raw, null);
    const items = Array.isArray(parsed) ? parsed : parsed?.items;
    if (Array.isArray(items)) {
      return items
        .map((item) => ({
          label: String(item?.label || "").trim(),
          type: item?.type === "yesno" ? "yesno" : "number",
          targetValue: String(item?.targetValue ?? item?.target ?? "").trim(),
          minimumValue: String(item?.minimumValue ?? item?.minimum ?? "").trim(),
        }))
        .filter((item) => item.label);
    }
  }

  return legacyLeadIndicatorLines(raw).map((label) => ({
    label,
    type: "number",
    targetValue: "",
    minimumValue: "",
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

  const numericValue = parseNumber(raw);
  const target = parseNumber(indicator.targetValue);
  const minimum = parseNumber(indicator.minimumValue);
  if (numericValue === null) return "yellow";
  if (minimum !== null && numericValue < minimum) return "red";
  if (target !== null && numericValue < target) return "yellow";
  return "green";
};

const getLeadIndicatorSignals = async ({ templateIds }) => {
  const empty = {
    green: 0,
    yellow: 0,
    red: 0,
    missing: 0,
    total: 0,
    needsAttention: 0,
    latestStatus: "green",
    items: [],
  };

  if (!templateIds.length) return empty;

  const parameterTable = await firstExistingTable([
    "kpiparameter",
    "kpi_parameters",
    "kpi_parameter",
  ]);
  if (!parameterTable) return empty;

  const columns = await getColumnInfo(parameterTable);
  const idCol = firstColumn(columns, ["id"]);
  const templateIdCol = firstColumn(columns, [
    "kpiTemplateId",
    "kpi_template_id",
    "template_id",
  ]);
  const parameterCol = firstColumn(columns, ["parameter", "name", "title"]);
  const leadCol = firstColumn(columns, ["lead_indicators", "leadIndicators"]);
  const dailyCol = firstColumn(columns, ["daily_achievements", "dailyAchievements"]);
  if (!idCol || !templateIdCol || !leadCol || !dailyCol) return empty;

  const templateTable = await firstExistingTable([
    "kpitemplate",
    "kpi_templates",
    "kpi_template",
  ]);
  const templateColumns = await getColumnInfo(templateTable);
  const templateIdColumn = firstColumn(templateColumns, ["id"]);
  const ownerColumn = firstColumn(templateColumns, [
    "ownerUserId",
    "owner_user_id",
    "owner_employee_id",
    "employee_id",
    "user_id",
  ]);
  const yearColumn = firstColumn(templateColumns, ["year"]);
  const monthColumn = firstColumn(templateColumns, ["month"]);
  const createdColumn = firstColumn(templateColumns, ["createdAt", "created_at", "date"]);

  const query = knex(`${parameterTable} as p`)
    .select(`p.${idCol} as parameterId`)
    .select(`p.${templateIdCol} as templateId`)
    .select(`p.${leadCol} as leadIndicators`)
    .select(`p.${dailyCol} as dailyAchievements`)
    .select(parameterCol ? `p.${parameterCol} as parameterName` : knex.raw("'' as parameterName"))
    .whereIn(`p.${templateIdCol}`, templateIds);

  if (templateTable && templateIdColumn) {
    query.leftJoin(`${templateTable} as t`, `p.${templateIdCol}`, `t.${templateIdColumn}`);
    query.select(ownerColumn ? `t.${ownerColumn} as ownerId` : knex.raw("NULL as ownerId"));
    query.select(yearColumn ? `t.${yearColumn} as year` : knex.raw("NULL as year"));
    query.select(monthColumn ? `t.${monthColumn} as month` : knex.raw("NULL as month"));
    query.select(createdColumn ? `t.${createdColumn} as createdAt` : knex.raw("NULL as createdAt"));
  } else {
    query.select(knex.raw("NULL as ownerId"));
    query.select(knex.raw("NULL as year"));
    query.select(knex.raw("NULL as month"));
    query.select(knex.raw("NULL as createdAt"));
  }

  const rows = await query;

  const summary = { ...empty, items: [] };

  rows.forEach((row) => {
    const indicators = parseLeadIndicatorDefinitions(row.leadIndicators);
    if (!indicators.length) return;

    const daily = parseJsonValue(row.dailyAchievements, {});
    const createdDate = row.createdAt ? new Date(row.createdAt) : null;
    const today = new Date();
    const year =
      Number(row.year || 0) ||
      (createdDate && !Number.isNaN(createdDate.getTime())
        ? createdDate.getFullYear()
        : today.getFullYear());
    const month =
      Number(row.month || 0) ||
      (createdDate && !Number.isNaN(createdDate.getTime())
        ? createdDate.getMonth() + 1
        : today.getMonth() + 1);
    const daysInMonth = new Date(year, month, 0).getDate();
    const isCurrentMonth =
      year === today.getFullYear() && month === today.getMonth() + 1;
    const isFutureMonth =
      year > today.getFullYear() ||
      (year === today.getFullYear() && month > today.getMonth() + 1);
    const elapsedDays = isFutureMonth
      ? 0
      : isCurrentMonth
        ? Math.min(today.getDate(), daysInMonth)
        : daysInMonth;
    const expectedDayKeys = Array.from({ length: elapsedDays }, (_, index) =>
      String(index + 1),
    );

    indicators.forEach((indicator, indicatorIndex) => {
      const rowDraft = daily?.[`li-${indicatorIndex}`] || {};
      const dayEntries = rowDraft && typeof rowDraft === "object" ? rowDraft : {};
      const dayKeys = expectedDayKeys.length
        ? expectedDayKeys
        : Object.keys(dayEntries).length
          ? Object.keys(dayEntries)
          : ["today"];

      dayKeys.forEach((dayKey) => {
        const status = evaluateLeadIndicatorStatus(indicator, dayEntries[dayKey]);
        summary[status] += 1;
        summary.total += 1;
        if (status !== "green") summary.needsAttention += 1;

        if (status !== "green" && summary.items.length < 12) {
          summary.items.push({
            status,
            employeeId: Number(row.ownerId || 0) || null,
            parameterId: Number(row.parameterId || 0) || null,
            parameterName: row.parameterName || "KPI Parameter",
            indicator: indicator.label,
            day: dayKey === "today" ? "" : String(dayKey).padStart(2, "0"),
            value: String(dayEntries[dayKey] ?? "").trim(),
            targetValue: indicator.targetValue,
            minimumValue: indicator.minimumValue,
            type: indicator.type,
            year,
            month,
          });
        }
      });
    });
  });

  summary.latestStatus =
    summary.red || summary.missing ? "red" : summary.yellow ? "yellow" : "green";

  return summary;
};

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
    : canViewOrg && requestedDepartmentId
      ? requestedDepartmentId
      : null;
  const effectiveEmployeeId =
    requestedEmployeeId && (canViewOrg || isManager)
      ? requestedEmployeeId
      : !canViewOrg && !isManager
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

const getEmployeeDepartmentLookup = async ({
  employeeTable,
  employeeColumns,
  companyId,
  employeeIds,
}) => {
  const lookup = new Map();
  if (!employeeTable || !employeeIds.length) return lookup;

  const idCol = firstColumn(employeeColumns, ["id", "employee_id"]);
  const companyCol = firstColumn(employeeColumns, [
    "company_id",
    "organizationId",
    "organization_id",
  ]);
  const departmentIdCol = firstColumn(employeeColumns, [
    "department_id",
    "departmentId",
  ]);
  const employeeDepartmentNameCol = firstColumn(employeeColumns, [
    "department_name",
    "departmentName",
    "department",
  ]);
  if (!idCol) return lookup;

  const departmentTable = await firstExistingTable(["departments", "department"]);
  const departmentColumns = await getColumnInfo(departmentTable);
  const departmentTableIdCol = firstColumn(departmentColumns, ["id"]);
  const departmentTableNameCol = firstColumn(departmentColumns, [
    "name",
    "department_name",
  ]);

  const query = knex(employeeTable)
    .select(`${employeeTable}.${idCol} as id`)
    .whereIn(`${employeeTable}.${idCol}`, employeeIds);

  if (departmentIdCol) {
    query.select(`${employeeTable}.${departmentIdCol} as departmentId`);
  } else {
    query.select(knex.raw("NULL as departmentId"));
  }

  if (
    departmentTable &&
    departmentIdCol &&
    departmentTableIdCol &&
    departmentTableNameCol
  ) {
    query
      .leftJoin(
        departmentTable,
        `${employeeTable}.${departmentIdCol}`,
        `${departmentTable}.${departmentTableIdCol}`,
      )
      .select(`${departmentTable}.${departmentTableNameCol} as departmentName`);
  } else if (employeeDepartmentNameCol) {
    query.select(
      `${employeeTable}.${employeeDepartmentNameCol} as departmentName`,
    );
  } else {
    query.select(knex.raw("? as departmentName", ["Unassigned"]));
  }

  if (companyCol && companyId) query.where(`${employeeTable}.${companyCol}`, companyId);

  const rows = await query;
  rows.forEach((row) => {
    const employeeId = Number(row.id);
    if (!employeeId) return;

    const departmentId = Number(row.departmentId || 0) || 0;
    const departmentName =
      String(row.departmentName || "").trim() ||
      (departmentId ? `Department ${departmentId}` : "Unassigned");

    lookup.set(employeeId, {
      id: departmentId,
      name: departmentName,
    });
  });

  return lookup;
};

const getKpiTemplateData = async ({ companyId, employeeIds, selectedYear, selectedMonth }) => {
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
  const companyCol = firstColumn(columns, [
    "company_id",
    "organizationId",
    "organization_id",
  ]);
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

  if (companyCol && companyId) query.where(companyCol, companyId);

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
  const parameterCreatedCol = firstColumn(parameterColumns, [
    "createdAt",
    "created_at",
    "date",
  ]);
  if (!templateIdCol || !scoreCol) {
    return { templates: templates.map((template) => ({ ...template, totalScore: round2(template.totalScore) })), templateIds };
  }

  const scoreQuery = knex(parameterTable)
    .select(`${templateIdCol} as templateId`)
    .sum({ score: scoreCol })
    .whereIn(templateIdCol, templateIds);
  if (parameterCreatedCol) {
    scoreQuery.max({ scoreDate: parameterCreatedCol });
    if (selectedYear && selectedMonth) {
      const start = new Date(Date.UTC(selectedYear, selectedMonth - 1, 1));
      const end = new Date(Date.UTC(selectedYear, selectedMonth, 1));
      scoreQuery.where(parameterCreatedCol, ">=", start).where(parameterCreatedCol, "<", end);
    } else if (selectedYear) {
      const start = new Date(Date.UTC(selectedYear, 0, 1));
      const end = new Date(Date.UTC(selectedYear + 1, 0, 1));
      scoreQuery.where(parameterCreatedCol, ">=", start).where(parameterCreatedCol, "<", end);
    }
  }
  scoreQuery.groupBy(templateIdCol);

  const scoreRows = await scoreQuery;
  const scoreByTemplate = new Map(
    scoreRows.map((row) => [
      String(row.templateId),
      {
        score: round2(row.score),
        scoreDate: row.scoreDate || null,
      },
    ]),
  );
  const filteredTemplateIds = new Set(scoreRows.map((row) => String(row.templateId)));

  return {
    templateIds: selectedYear && parameterCreatedCol
      ? templateIds.filter((templateId) => filteredTemplateIds.has(String(templateId)))
      : templateIds,
    templates: templates
      .filter((template) =>
        selectedYear && parameterCreatedCol
          ? filteredTemplateIds.has(String(template.id))
          : true,
      )
      .map((template) => {
        const scoreInfo = scoreByTemplate.get(String(template.id));
        return {
          ...template,
          scoreDate: scoreInfo?.scoreDate || template.createdAt,
          totalScore: scoreInfo ? scoreInfo.score : round2(template.totalScore),
        };
      }),
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

const buildKpiPerformanceTrend = (scorecards = [], selectedYear = null) => {
  if (!scorecards.length && !selectedYear) return [];

  const monthBuckets = [];

  if (selectedYear) {
    for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
      const bucketDate = new Date(Date.UTC(selectedYear, monthIndex, 1));
      const month = `${bucketDate.getUTCFullYear()}-${String(
        bucketDate.getUTCMonth() + 1,
      ).padStart(2, "0")}`;
      const monthLabel = new Intl.DateTimeFormat("en-US", {
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      }).format(bucketDate);

      monthBuckets.push({
        month,
        monthLabel,
        totalScore: 0,
        scorecardCount: 0,
        lowKpiCount: 0,
        topPerformerCount: 0,
      });
    }
  } else {
    const latestTime = scorecards.reduce(
      (latest, item) => Math.max(latest, item.monthDate.getTime()),
      0,
    );
    const latestDate = latestTime ? new Date(latestTime) : new Date();
    const endMonth = new Date(
      Date.UTC(latestDate.getUTCFullYear(), latestDate.getUTCMonth(), 1),
    );

    for (let offset = 11; offset >= 0; offset -= 1) {
      const bucketDate = new Date(endMonth);
      bucketDate.setUTCMonth(endMonth.getUTCMonth() - offset);
      const month = `${bucketDate.getUTCFullYear()}-${String(
        bucketDate.getUTCMonth() + 1,
      ).padStart(2, "0")}`;
      const monthLabel = new Intl.DateTimeFormat("en-US", {
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      }).format(bucketDate);

      monthBuckets.push({
        month,
        monthLabel,
        totalScore: 0,
        scorecardCount: 0,
        lowKpiCount: 0,
        topPerformerCount: 0,
      });
    }
  }

  const bucketByMonth = new Map(monthBuckets.map((bucket) => [bucket.month, bucket]));
  scorecards.forEach((item) => {
    const month = `${item.monthDate.getUTCFullYear()}-${String(
      item.monthDate.getUTCMonth() + 1,
    ).padStart(2, "0")}`;
    const bucket = bucketByMonth.get(month);
    if (!bucket) return;

    bucket.totalScore += item.score;
    bucket.scorecardCount += 1;
    if (item.score < 70) bucket.lowKpiCount += 1;
    if (item.score >= 70) bucket.topPerformerCount += 1;
  });

  return monthBuckets.map((bucket) => ({
    month: bucket.month,
    monthLabel: bucket.monthLabel,
    averageScore: bucket.scorecardCount
      ? round2(bucket.totalScore / bucket.scorecardCount)
      : 0,
    scorecardCount: bucket.scorecardCount,
    lowKpiCount: bucket.lowKpiCount,
    topPerformerCount: bucket.topPerformerCount,
  }));
};

const buildDepartmentKpiPerformance = (scorecards = []) => {
  const groups = new Map();

  scorecards.forEach((item) => {
    const departmentName = String(item.departmentName || "Unassigned").trim() || "Unassigned";
    const departmentId = Number(item.departmentId || 0) || 0;
    const key = departmentId ? String(departmentId) : departmentName.toLowerCase();
    const group = groups.get(key) || {
      departmentId,
      departmentName,
      totalScore: 0,
      scorecardCount: 0,
      lowKpiCount: 0,
      topPerformerCount: 0,
    };

    group.totalScore += item.score;
    group.scorecardCount += 1;
    if (item.score < 70) group.lowKpiCount += 1;
    if (item.score >= 70) group.topPerformerCount += 1;
    groups.set(key, group);
  });

  return Array.from(groups.values())
    .map((group) => ({
      departmentId: group.departmentId,
      departmentName: group.departmentName,
      averageScore: group.scorecardCount
        ? round2(group.totalScore / group.scorecardCount)
        : 0,
      scorecardCount: group.scorecardCount,
      lowKpiCount: group.lowKpiCount,
      topPerformerCount: group.topPerformerCount,
    }))
    .sort(
      (a, b) =>
        b.averageScore - a.averageScore ||
        b.scorecardCount - a.scorecardCount ||
        a.departmentName.localeCompare(b.departmentName),
    );
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
    const selectedYear =
      Number.parseInt(String(req.query.year || ""), 10) || null;
    const selectedMonth =
      Number.parseInt(String(req.query.month || ""), 10) || null;
    const normalizedYear =
      selectedYear && selectedYear >= 2000 && selectedYear <= 2100
        ? selectedYear
        : null;
    const normalizedMonth =
      selectedMonth && selectedMonth >= 1 && selectedMonth <= 12
        ? selectedMonth
        : null;

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
      companyId,
      employeeIds: scope.employeeIds,
      selectedYear: normalizedYear,
      selectedMonth: normalizedMonth,
    });
    const employeeDepartmentLookup = await getEmployeeDepartmentLookup({
      employeeTable: scope.employeeTable,
      employeeColumns: scope.employeeColumns,
      companyId,
      employeeIds: scope.employeeIds,
    });

    const validScorecards = templates
      .map((template) => {
        const monthDate = new Date(template.scoreDate || template.createdAt);
        const ownerId = Number(template.ownerId || 0);
        const department = employeeDepartmentLookup.get(ownerId) || {
          id: 0,
          name: "Unassigned",
        };

        return {
          id: template.id,
          monthDate,
          ownerId,
          ownerName: template.ownerName || template.title || "Unassigned",
          departmentId: department.id,
          departmentName: department.name,
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
    const kpiPerformanceTrend = buildKpiPerformanceTrend(
      validScorecards,
      normalizedYear,
    );
    const departmentKpiPerformance = buildDepartmentKpiPerformance(validScorecards);

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
      leadIndicatorSignals,
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
      getLeadIndicatorSignals({ templateIds }),
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
      kpiTrend: kpiPerformanceTrend,
      kpiPerformanceTrend,
      departmentKpiPerformance,
      competencyGrowthPct,
      correctiveActionStatus,
      correctiveActionTotal,
      leadIndicatorSignals,
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
