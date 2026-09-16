const db = require("../db/db");
const service = require("../services/kpiHierarchyService");

const handler = (fn) => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (error) {
    if (!error.status) console.error("KPI hierarchy error:", error);
    res.status(error.status || 500).json({
      message: error.status
        ? error.message
        : "Unable to process KPI hierarchy.",
    });
  }
};

exports.getHierarchy = handler(async (req) => {
  const ctx = service.context(req.user, req.query);
  return db.transaction(async (trx) =>
    service.visibleTree(req.user, await service.load(trx, ctx)),
  );
});
exports.saveScore = handler((req) =>
  service.saveScore(
    req.user,
    service.context(req.user, req.body),
    service.positiveInt(req.params.employeeId, "employee"),
    req.body.score,
  ),
);
exports.setParent = handler((req) =>
  service.setParent(
    req.user,
    service.context(req.user, req.body),
    service.positiveInt(req.params.employeeId, "employee"),
    req.body.parentEmployeeId === null
      ? null
      : service.positiveInt(req.body.parentEmployeeId, "reporting manager"),
  ),
);

exports.getTemplates = handler(async (req) => {
  const companyId = service.positiveInt(
    req.user?.company_id,
    "company context",
  );
  // Template definitions are shared within the company; employee score visibility
  // remains restricted by the existing self/department/organization rules.
  const templates = await db("kpi_templates as t")
    .leftJoin("employees as e", function () {
      this.on("e.id", "t.owner_employee_id").andOn(
        "e.company_id",
        "t.company_id",
      );
    })
    .where("t.company_id", companyId)
    .select("t.id", "t.title", "t.created_at", "e.first_name", "e.last_name")
    .orderBy("t.id", "desc");
  const parameters = await db("kpi_parameters as p")
    .join("kpi_templates as t", "t.id", "p.kpi_template_id")
    .where("t.company_id", companyId)
    .select("p.kpi_template_id", "p.name")
    .orderBy("p.id");
  const names = new Map();
  for (const parameter of parameters) {
    const id = Number(parameter.kpi_template_id);
    if (!names.has(id)) names.set(id, []);
    names.get(id).push(parameter.name);
  }
  return templates.map(({ first_name, last_name, ...template }) => ({
    ...template,
    year: new Date(template.created_at).getFullYear(),
    month: new Date(template.created_at).getMonth() + 1,
    ownerName:
      [first_name, last_name].filter(Boolean).join(" ") || "Unassigned owner",
    parameterNames: names.get(Number(template.id)) || [],
  }));
});
