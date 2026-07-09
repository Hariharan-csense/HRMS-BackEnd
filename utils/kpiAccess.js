const normalizeRole = (value) =>
  String(value || "")
    .replace(/[\s_]/g, "")
    .toUpperCase();

const ORGANIZATION_VIEW_ROLES = new Set([
  "ADMIN",
  "CEO",
  "SUPERADMIN",
  "PILLARS",
  "HR",
]);

const DEPARTMENT_VIEW_ROLES = new Set([
  "MANAGER",
  "DEPARTMENTHEAD",
  "DEPTHEAD",
  "HOD",
  "PDHEAD",
]);

const canViewOrganization = (role) =>
  ORGANIZATION_VIEW_ROLES.has(normalizeRole(role));

const getCurrentEmployeeId = (user) =>
  Number(user?.employee_id || user?.id || 0) || null;

const getKpiVisibilityScope = (user) => {
  const role = normalizeRole(user?.role);
  if (ORGANIZATION_VIEW_ROLES.has(role)) return "organization";
  if (DEPARTMENT_VIEW_ROLES.has(role)) return "department";
  return "self";
};

module.exports = {
  normalizeRole,
  canViewOrganization,
  getCurrentEmployeeId,
  getKpiVisibilityScope,
};
