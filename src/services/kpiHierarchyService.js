const db = require("../db/db");
const { buildHierarchy, validateParent, fail } = require("./kpiHierarchyTree");
const {
  getKpiVisibilityScope,
  getCurrentEmployeeId,
} = require("../utils/kpiAccess");

function positiveInt(value, label, max = 2147483647) {
  if (
    !/^\d+$/.test(String(value)) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) < 1 ||
    Number(value) > max
  ) {
    throw fail(`Invalid ${label}.`);
  }
  return Number(value);
}

function context(user, input) {
  return {
    companyId: positiveInt(user?.company_id, "company context"),
    templateId: positiveInt(input.templateId, "template"),
    year: positiveInt(input.year, "year", 9999),
    month: positiveInt(input.month, "month", 12),
    parameterId:
      input.parameterId == null || input.parameterId === ""
        ? null
        : positiveInt(input.parameterId, "parameter"),
  };
}

async function employeesForCompany(trx, companyId) {
  return trx("employees as e")
    .leftJoin("departments as d", function () {
      this.on("d.id", "e.department_id").andOn("d.company_id", "e.company_id");
    })
    .leftJoin("designations as g", function () {
      this.on("g.id", "e.designation_id").andOn("g.company_id", "e.company_id");
    })
    .leftJoin("branches as b", function () {
      this.on("b.id", "e.branch_id").andOn("b.company_id", "e.company_id");
    })
    .where("e.company_id", companyId)
    .select(
      "e.id",
      "e.manager_id",
      "e.first_name",
      "e.last_name",
      "e.department_id",
      "e.branch_id",
      "d.name as department",
      "g.name as designation",
      "b.name as branch",
    )
    .orderBy("e.id");
}

function canAccessEmployee(user, employee) {
  const scope = getKpiVisibilityScope(user);
  return (
    scope === "organization" ||
    (scope === "department" &&
      Number(user.department_id) > 0 &&
      Number(user.department_id) ===
        Number(employee.department_id ?? employee.departmentId)) ||
    (scope === "self" && Number(employee.id) === getCurrentEmployeeId(user))
  );
}

async function load(trx, ctx) {
  const { companyId, templateId, year, month, parameterId } = ctx;
  const template = await trx("kpi_templates")
    .where({ id: templateId, company_id: companyId })
    .first();
  if (!template) throw fail("KPI template not found.", 404);
  const parameters = await trx("kpi_parameters as p")
    .join("kpi_templates as t", "t.id", "p.kpi_template_id")
    .where("t.company_id", companyId)
    .where("t.id", templateId)
    .select("p.id", "p.name", "p.kpi_score", "p.achievement");
  if (parameterId && !parameters.some((p) => Number(p.id) === parameterId))
    throw fail("Parameter does not belong to this template.");
  const employees = await employeesForCompany(trx, companyId);
  const entries = await trx("kpi_hierarchy_scores").where({
    company_id: companyId,
    kpi_template_id: templateId,
    year,
    month,
  });
  const selected = parameterId
    ? parameters.filter((p) => Number(p.id) === parameterId)
    : parameters;
  const byEmployee = new Map();
  for (const entry of entries) {
    if (!byEmployee.has(Number(entry.employee_id)))
      byEmployee.set(Number(entry.employee_id), new Map());
    byEmployee
      .get(Number(entry.employee_id))
      .set(Number(entry.kpi_parameter_id), entry.score);
  }
  // Existing owner scores are available in the template's original calendar period.
  // Achievement-based scorecard values are authoritative for their owner.
  const created = new Date(template.created_at);
  const legacyPeriod =
    created.getFullYear() === year && created.getMonth() + 1 === month;
  const scores = new Map();
  for (const employee of employees) {
    const values = selected
      .map((p) => {
        const stored = byEmployee.get(Number(employee.id));
        if (legacyPeriod &&
          Number(template.owner_employee_id) === Number(employee.id) &&
          p.achievement != null) return p.kpi_score;
        return stored?.has(Number(p.id)) ? stored.get(Number(p.id)) : null;
      })
      .filter((v) => v != null);
    // Existing scorecards sum weighted parameter scores. Preserve that convention.
    scores.set(
      Number(employee.id),
      values.length ? values.reduce((sum, v) => sum + Number(v), 0) : null,
    );
  }
  const hierarchy = buildHierarchy(employees, scores);
  const owner = hierarchy.nodes.get(Number(template.owner_employee_id));
  if (owner?.scoreType === "manual" && legacyPeriod && selected.some((p) => p.achievement != null)) {
    owner.scoreSource = "scorecard";
  }
  return {
    ...hierarchy,
    parameters: parameters.map(({ id, name }) => ({ id, name })),
    ownerEmployeeId: template.owner_employee_id == null ? null : Number(template.owner_employee_id),
    employees,
  };
}

function visibleTree(user, result) {
  const visible = new Map();
  for (const node of result.nodes.values()) {
    if (canAccessEmployee(user, node))
      visible.set(node.id, { ...node, children: [] });
  }
  const tree = [];
  for (const node of visible.values()) {
    const parent = visible.get(node.parentEmployeeId);
    if (parent) parent.children.push(node);
    else tree.push(node);
  }
  return {
    tree,
    parameters: result.parameters,
    ownerEmployeeId: result.ownerEmployeeId,
    canManageHierarchy: getKpiVisibilityScope(user) === "organization",
  };
}

async function calculateHierarchyScore(
  employeeId,
  templateId,
  year,
  month,
  companyId,
  parameterId = null,
  trx = db,
) {
  const result = await load(trx, {
    companyId,
    templateId,
    year,
    month,
    parameterId,
  });
  const node = result.nodes.get(Number(employeeId));
  if (!node) throw fail("Employee not found.", 404);
  return node;
}

// Derived parents are never persisted: reloading always recalculates every ancestor,
// including after legacy edits, relationship changes, or employee deletion.
async function recalculateParentScores(
  employeeId,
  templateId,
  year,
  month,
  companyId,
  parameterId = null,
  trx = db,
) {
  const result = await load(trx, {
    companyId,
    templateId,
    year,
    month,
    parameterId,
  });
  let node = result.nodes.get(Number(employeeId));
  if (!node) throw fail("Employee not found.", 404);
  const parents = [];
  while ((node = result.nodes.get(node.parentEmployeeId))) parents.push(node);
  return parents;
}

async function lockCompany(trx, companyId) {
  // One lock order for score writes and reporting changes prevents concurrent cycles.
  const company = await trx("companies")
    .where({ id: companyId })
    .forUpdate()
    .first("id");
  if (!company) throw fail("Company not found.", 404);
}

async function saveScore(user, ctx, employeeId, score, connection = db) {
  if (!ctx.parameterId)
    throw fail("Select a parameter before entering a score.");
  if (
    score !== null &&
    (typeof score !== "number" ||
      !Number.isFinite(score) ||
      Math.abs(score) > 99999999.9999)
  )
    throw fail("Score must be a valid number or null.");
  return connection.transaction(async (trx) => {
    await lockCompany(trx, ctx.companyId);
    const result = await load(trx, ctx);
    const node = result.nodes.get(employeeId);
    if (!node) throw fail("Employee not found.", 404);
    if (!canAccessEmployee(user, node)) throw fail("Access denied.", 403);
    if (node.scoreSource === "scorecard") throw fail("Update the achievement in the original scorecard to change this score.", 409);
    if (node.scoreType !== "manual")
      throw fail("Parent scores are calculated automatically.", 409);
    await trx("kpi_hierarchy_scores")
      .insert({
        company_id: ctx.companyId,
        employee_id: employeeId,
        kpi_template_id: ctx.templateId,
        kpi_parameter_id: ctx.parameterId,
        year: ctx.year,
        month: ctx.month,
        score,
      })
      .onConflict([
        "company_id",
        "kpi_template_id",
        "year",
        "month",
        "employee_id",
        "kpi_parameter_id",
      ])
      .merge({ score, updated_at: trx.fn.now() });
    return visibleTree(user, await load(trx, ctx));
  });
}

async function setParent(user, ctx, employeeId, parentId, connection = db) {
  if (getKpiVisibilityScope(user) !== "organization")
    throw fail(
      "Organization access is required to change reporting managers.",
      403,
    );
  return connection.transaction(async (trx) => {
    await lockCompany(trx, ctx.companyId);
    const employees = await employeesForCompany(trx, ctx.companyId);
    validateParent(employees, employeeId, parentId);
    await trx("employees")
      .where({ id: employeeId, company_id: ctx.companyId })
      .update({ manager_id: parentId, updated_at: trx.fn.now() });
    return visibleTree(user, await load(trx, ctx));
  });
}

module.exports = {
  context,
  positiveInt,
  load,
  visibleTree,
  saveScore,
  setParent,
  calculateHierarchyScore,
  recalculateParentScores,
  canAccessEmployee,
};
