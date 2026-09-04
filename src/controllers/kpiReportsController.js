const knex = require("../db/db");
const {
  normalizeRole,
  canViewOrganization,
  getCurrentEmployeeId,
  getKpiVisibilityScope,
} = require("../utils/kpiAccess");

const ownerNameExpr = () =>
  knex.raw(
    "TRIM(CONCAT(COALESCE(e.first_name,''), ' ', COALESCE(e.last_name,'')))",
  );

const statusFromScore = (score) => {
  const value = Number(score);
  if (!Number.isFinite(value)) return "Needs Improvement";
  if (value >= 85) return "Excellent";
  if (value >= 70) return "Good";
  return "Needs Improvement";
};

const actionStatusMap = {
  PENDING: "Pending",
  IN_PROGRESS: "In Progress",
  COMPLETED: "Completed",
};

const formatDecimalValue = (value) => {
  if (value == null || value === "") return "";
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return String(value);
  return Number.isInteger(parsed) ? String(parsed) : String(parsed);
};

const monthLabel = (monthNumber) => {
  const month = Number(monthNumber);
  const labels = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  return labels[month - 1] || String(monthNumber || "");
};

const MONTH_LABELS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const uniqueSorted = (values = []) =>
  [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))].sort(
    (a, b) => a.localeCompare(b),
  );

const fetchReportFilters = async ({ companyId, role, user }) => {
  const filters = {
    employees: [],
    departments: [],
    roles: [],
    parameters: [],
    years: [String(new Date().getFullYear())],
    months: [...MONTH_LABELS],
  };

  if (!companyId) return filters;

  const employeeQuery = knex("employees as e")
    .leftJoin("departments as d", "e.department_id", "d.id")
    .where("e.company_id", companyId)
    .select({ name: ownerNameExpr() })
    .select("d.name as departmentName")
    .select("e.role as roleName")
    .orderBy("name", "asc");

  employeeQuery.where(function () {
    this.whereNull("e.status").orWhereNot("e.status", "Inactive");
  });

  const scope = getKpiVisibilityScope(user);
  if (scope === "self") {
    const currentEmployeeId = getCurrentEmployeeId(user);
    if (currentEmployeeId) employeeQuery.where("e.id", currentEmployeeId);
  } else if (scope === "department") {
    const currentDepartmentId = Number(user?.department_id || 0) || null;
    if (currentDepartmentId) employeeQuery.where("e.department_id", currentDepartmentId);
  }

  const employeeRows = await employeeQuery;
  filters.employees = uniqueSorted(employeeRows.map((row) => row.name));
  filters.departments = uniqueSorted(
    employeeRows.map((row) => row.departmentName),
  );
  filters.roles = uniqueSorted(employeeRows.map((row) => row.roleName));

  const departmentRows = await knex("departments")
    .where("company_id", companyId)
    .select("name")
    .orderBy("name", "asc");
  filters.departments = uniqueSorted([
    ...filters.departments,
    ...departmentRows.map((row) => row.name),
  ]);

  const parameterQuery = knex("kpi_parameters as p")
    .join("kpi_templates as t", "p.kpi_template_id", "t.id")
    .where("t.company_id", companyId)
    .distinct("p.name")
    .select("p.name")
    .orderBy("p.name", "asc");

  if (scope === "self") {
    const currentEmployeeId = getCurrentEmployeeId(user);
    if (currentEmployeeId) parameterQuery.where("t.owner_employee_id", currentEmployeeId);
  } else if (scope === "department") {
    const currentDepartmentId = Number(user?.department_id || 0) || null;
    if (currentDepartmentId) parameterQuery.where("t.department_id", currentDepartmentId);
  }

  const parameterRows = await parameterQuery;
  filters.parameters = uniqueSorted(parameterRows.map((row) => row.name));

  const templateYearRows = await knex("kpi_templates")
    .where("company_id", companyId)
    .select("created_at");
  const years = new Set([new Date().getFullYear()]);
  templateYearRows.forEach((row) => {
    if (!row.created_at) return;
    years.add(new Date(row.created_at).getFullYear());
  });
  filters.years = [...years]
    .sort((a, b) => b - a)
    .map((value) => String(value));

  return filters;
};

exports.getKpiReportsSummary = async (req, res) => {
  try {
    const companyId = req.user?.company_id || null;
    const role = normalizeRole(req.user?.role);

    const templateQuery = knex("kpi_templates as t")
      .leftJoin("employees as e", "t.owner_employee_id", "e.id")
      .leftJoin("departments as d", "e.department_id", "d.id")
      .select("t.id as templateId")
      .select("t.title as templateTitle")
      .select("t.total_score as scorecardScore")
      .select("t.created_at as templateCreatedAt")
      .select("e.id as employeeId")
      .select({ employeeName: ownerNameExpr() })
      .select("d.name as departmentName")
      .select("e.role as roleName")
      .orderBy("t.created_at", "desc")
      .orderBy("t.id", "desc");

    if (companyId) templateQuery.where("t.company_id", companyId);

    const scope = getKpiVisibilityScope(req.user);
    const currentEmployeeId = getCurrentEmployeeId(req.user);
    const currentDepartmentId =
      Number(req.user?.department_id || 0) || null;
    if (scope === "self") {
      if (currentEmployeeId) templateQuery.where("t.owner_employee_id", currentEmployeeId);
    } else if (scope === "department") {
      if (currentDepartmentId) templateQuery.where("t.department_id", currentDepartmentId);
    }

    const templates = await templateQuery;
    const templateIds = templates.map((row) => Number(row.templateId)).filter(Boolean);

    const parameterRows = templateIds.length
      ? await knex("kpi_parameters as p")
          .whereIn("p.kpi_template_id", templateIds)
          .select("p.id as parameterId")
          .select("p.kpi_template_id as templateId")
          .select("p.name as parameter")
          .select("p.reference as reference")
          .select("p.commitment as commitment")
          .select("p.achievement as achievement")
          .select("p.kpi_score as score")
          .orderBy("p.kpi_template_id", "desc")
          .orderBy("p.id", "asc")
      : [];

    const parameterByTemplate = new Map();
    parameterRows.forEach((row) => {
      const key = Number(row.templateId);
      if (!parameterByTemplate.has(key)) parameterByTemplate.set(key, []);
      parameterByTemplate.get(key).push(row);
    });

    const kpiRows = [];
    templates.forEach((template) => {
      const createdAt = template.templateCreatedAt
        ? new Date(template.templateCreatedAt)
        : new Date();
      const year = createdAt.getFullYear();
      const month = createdAt.getMonth() + 1;
      const monthText = monthLabel(month);
      const scorecardScore = Number(template.scorecardScore || 0);

      const rows = parameterByTemplate.get(Number(template.templateId)) || [];
      rows.forEach((row) => {
        const score = Number(row.score || 0);
        kpiRows.push({
          templateId: Number(template.templateId),
          templateTitle: template.templateTitle || null,
          employee: template.employeeName || "Employee",
          employeeDepartment: template.departmentName || "",
          department: template.departmentName || "",
          role: template.roleName || "",
          parameter: row.parameter || "",
          reference: formatDecimalValue(row.reference),
          commitment: Number(row.commitment || 0),
          achievement: Number(row.achievement || 0),
          score,
          scorecardScore,
          status: statusFromScore(score),
          year,
          month: monthText,
          periodDate: createdAt.toISOString(),
          growth: 0,
          initialCompetency: 0,
          currentCompetency: 0,
          actionsRaised: 0,
          actionsClosed: 0,
        });
      });
    });

    const reviewQuery = knex("kpi_parameter_reviews as pr")
      .leftJoin("kpi_templates as t", "pr.kpi_template_id", "t.id")
      .leftJoin("kpi_parameters as p", "pr.kpi_parameter_id", "p.id")
      .leftJoin("employees as e", "t.owner_employee_id", "e.id")
      .leftJoin("departments as d", "e.department_id", "d.id")
      .select("pr.id as id")
      .select("pr.feedback as feedback")
      .select("pr.created_at as createdAt")
      .select("pr.target_date as targetDate")
      .select("pr.status as status")
      .select({ employeeName: ownerNameExpr() })
      .select("d.name as departmentName")
      .select("e.role as roleName")
      .select("p.name as parameterName")
      .orderBy("pr.created_at", "desc")
      .orderBy("pr.id", "desc");

    if (companyId) reviewQuery.where("t.company_id", companyId);
    if (!canViewOrganization(role)) {
      const currentEmployeeId = getCurrentEmployeeId(req.user);
      if (currentEmployeeId) reviewQuery.where("t.owner_employee_id", currentEmployeeId);
    }

    const reviews = await reviewQuery;
    const correctiveActions = reviews
      .filter((row) => row.feedback || row.targetDate)
      .map((row) => {
        const created = row.createdAt ? new Date(row.createdAt) : new Date();
        const target = row.targetDate ? String(row.targetDate).slice(0, 10) : "";
        const baseStatus = actionStatusMap[String(row.status || "PENDING").toUpperCase()] || "Pending";
        const overdue =
          baseStatus !== "Completed" &&
          target &&
          new Date(`${target}T00:00:00`).getTime() < new Date().setHours(0, 0, 0, 0);
        return {
          employee: row.employeeName || "Employee",
          department: row.departmentName || "",
          role: row.roleName || "",
          parameter: row.parameterName || "",
          action: row.feedback || "",
          createdDate: created.toISOString().slice(0, 10),
          targetDate: target,
          status: overdue ? "Overdue" : baseStatus,
          year: created.getFullYear(),
          month: monthLabel(created.getMonth() + 1),
        };
      });

    const trendMap = new Map();
    templates.forEach((template) => {
      const createdAt = template.templateCreatedAt
        ? new Date(template.templateCreatedAt)
        : new Date();
      const key = `${createdAt.getFullYear()}-${String(createdAt.getMonth() + 1).padStart(2, "0")}`;
      if (!trendMap.has(key)) trendMap.set(key, { total: 0, count: 0, label: key, date: createdAt });
      const entry = trendMap.get(key);
      entry.total += Number(template.scorecardScore || 0);
      entry.count += 1;
    });

    const monthlyTrend = [...trendMap.values()]
      .sort((a, b) => a.label.localeCompare(b.label))
      .slice(-12)
      .map((entry) => ({
        label: `${monthLabel(entry.date.getMonth() + 1)} ${entry.date.getFullYear()}`,
        score: entry.count ? Math.round((entry.total / entry.count) * 100) / 100 : 0,
      }));

    const filters = await fetchReportFilters({
      companyId,
      role,
      user: req.user,
    });

    return res.json({ kpiRows, correctiveActions, monthlyTrend, filters });
  } catch (error) {
    console.error("KPI reports summary error:", error);
    return res.status(500).json({ message: "Unable to load KPI reports summary." });
  }
};

