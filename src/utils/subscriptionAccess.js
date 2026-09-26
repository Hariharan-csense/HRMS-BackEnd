const db = require("../db/db");
const { getInternalFullAccessCompany } = require("./internalCompany");
const {
  companyHasActiveAddonModule,
  employeeHasAddonModuleAssignment,
} = require("./subscriptionAddons");
const { hasKpiFreeAccess } = require("./kpiTrial");

const FREE_MODULES = new Set([
  "dashboard",
  "subscription",
  "organization",
  "role_access",
  "employees",
  "pulse_surveys",
]);

const BASIC_MODULES = new Set([
  ...FREE_MODULES,
  "attendance",
  "shift management",
  "leave",
  "reports",
]);

const STANDARD_MODULES = new Set([
  ...BASIC_MODULES,
  "payroll",
  "client_attendance",
  "client_attendance_admin",
  "my_clients",
  "my_analytics",
  "expenses",
  "assets",
  "live_tracking",
  "tickets",
  "hr_helpdesk",
  "ai_assistant",
  "role_access",
]);

const normalize = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();

const addSet = (target, source) => source.forEach((item) => target.add(item));

const modulesFromDescription = (description) => {
  const modules = new Set(FREE_MODULES);
  for (const line of String(description || "")
    .split(/\r?\n/)
    .map(normalize)
    .filter(Boolean)) {
    if (line.includes("all in basic")) addSet(modules, BASIC_MODULES);
    if (line.includes("all in standard")) addSet(modules, STANDARD_MODULES);
    if (line.includes("organization")) modules.add("organization");
    if (
      line.includes("role") &&
      (line.includes("permission") || line.includes("access"))
    )
      modules.add("role_access");
    if (line.includes("employee")) modules.add("employees");
    if (line.includes("attendance")) modules.add("attendance");
    if (line.includes("roster") || line.includes("shift"))
      modules.add("shift management");
    if (line.includes("leave")) modules.add("leave");
    if (line.includes("report")) modules.add("reports");
    if (line.includes("payroll")) modules.add("payroll");
    if (line.includes("expense")) modules.add("expenses");
    if (line.includes("asset")) modules.add("assets");
    if (line.includes("live tracking")) modules.add("live_tracking");
    if (line.includes("client attendance")) modules.add("client_attendance");
    if (
      line.includes("recruitment") ||
      line.includes("rms") ||
      line.includes("hr management")
    )
      modules.add("hr_management");
    if (line.includes("exit") || line.includes("offboarding"))
      modules.add("exit");
    if (line.includes("pulse") || line.includes("survey"))
      modules.add("pulse_surveys");
    if (line.includes("kpi")) modules.add("kpi");
    if (line.includes("ticket") || line.includes("helpdesk"))
      modules.add("tickets");
    if (line.includes("ai assistant") || line.includes("chatbot"))
      modules.add("ai_assistant");
  }
  return modules;
};

const getActiveSubscription = async (companyId) => {
  if (!companyId) return null;
  return db("company_subscriptions as cs")
    .join("subscription_plans as sp", "cs.plan_id", "sp.id")
    .select("cs.status", "cs.trial_end_date", "cs.end_date", "sp.name as plan_name", "sp.description")
    .where("cs.company_id", companyId)
    .where(function () {
      this.where(function () {
        this.where("cs.status", "trial").andWhere(
          "cs.trial_end_date",
          ">=",
          db.fn.now(),
        );
      }).orWhere(function () {
        this.where("cs.status", "active").andWhere(
          "cs.end_date",
          ">=",
          db.fn.now(),
        );
      });
    })
    .orderBy("cs.created_at", "desc")
    .first();
};

const hasSubscribedModuleAccess = async (user, moduleKey) => {
  if (String(user?.role || "").toLowerCase() === "superadmin") return true;
  if (!user?.company_id) return false;
  if (await getInternalFullAccessCompany(user.company_id, db)) return true;

  const wanted = normalize(moduleKey);
  if (Number(user.company_id) === 51 && wanted === "essl_setup") return true;
  if (
    wanted === "kpi" &&
    (await hasKpiFreeAccess(user.company_id, new Date(), db))
  ) {
    return true;
  }

  const subscription = await getActiveSubscription(user.company_id);
  if (!subscription) {
    if (wanted === "kpi") return false;
    return FREE_MODULES.has(wanted);
  }

  if (subscription.status === "trial" && wanted !== "kpi") return true;
  const isFreePlan = /free\s*(plan|package)?/i.test(subscription.plan_name || "");
  if (
    !(wanted === "kpi" && isFreePlan) &&
    modulesFromDescription(subscription.description).has(wanted)
  ) {
    return true;
  }

  if (await companyHasActiveAddonModule(user.company_id, wanted, db)) {
    if (String(user.type || "").toLowerCase() !== "employee") return true;
    return employeeHasAddonModuleAssignment(
      user.company_id,
      user.id,
      wanted,
      db,
    );
  }

  return false;
};

module.exports = { hasSubscribedModuleAccess };
