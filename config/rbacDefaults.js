const { RBAC_ACTIONS, RBAC_MODULE_CATALOG } = require("./rbacCatalog");

const emptyPermissions = () =>
  RBAC_ACTIONS.reduce((permissions, action) => {
    permissions[action] = 0;
    return permissions;
  }, {});

const enabledPermissions = (enabledActions = RBAC_ACTIONS) => {
  const permissions = emptyPermissions();
  enabledActions.forEach((action) => {
    if (Object.prototype.hasOwnProperty.call(permissions, action)) {
      permissions[action] = 1;
    }
  });
  return permissions;
};

const createCatalogModules = (basePermissions = emptyPermissions()) => {
  const modules = {};

  RBAC_MODULE_CATALOG.forEach((moduleEntry) => {
    if (!moduleEntry?.key) return;

    const submodules = {};
    (moduleEntry.submodules || []).forEach((subEntry) => {
      if (!subEntry?.key) return;
      submodules[subEntry.key] = {
        permissions: { ...basePermissions },
      };
    });

    modules[moduleEntry.key] = {
      permissions: { ...basePermissions },
      submodules,
    };
  });

  return modules;
};

const setModulePermissions = (modules, moduleKey, actions) => {
  if (!modules[moduleKey]) return;
  modules[moduleKey].permissions = enabledPermissions(actions);
};

const setSubmodulePermissions = (modules, moduleKey, submoduleKey, actions) => {
  const submodule = modules[moduleKey]?.submodules?.[submoduleKey];
  if (!submodule) return;
  submodule.permissions = enabledPermissions(actions);
};

const EMPLOYEE_DEFAULTS = [
  { module: "dashboard", actions: ["view"] },
  { module: "employees", submodule: "profile", actions: ["view", "create", "update", "delete"] },
  { module: "client_attendance", actions: ["view", "create", "update", "delete"] },
  { module: "my_clients", actions: ["view", "create", "update", "delete"] },
  { module: "attendance", actions: ["view", "create", "update"] },
  { module: "attendance", submodule: "capture", actions: ["view", "create", "update", "delete"] },
  { module: "attendance", submodule: "log", actions: ["view"] },
  {
    module: "attendance",
    submodule: "override",
    actions: ["view", "create", "update", "delete", "approve", "reject"],
  },
  { module: "leave", actions: ["view", "create", "update", "delete"] },
  { module: "leave", submodule: "apply", actions: ["view", "create", "update"] },
  { module: "leave", submodule: "balance", actions: ["view"] },
  { module: "leave", submodule: "leave_types", actions: ["view"] },
  { module: "leave", submodule: "permission", actions: ["view", "create"] },
  { module: "expenses", actions: ["view", "create", "update", "delete"] },
  { module: "expenses", submodule: "claims", actions: ["view", "create", "update", "delete"] },
  { module: "pulse_surveys", actions: ["view", "create", "update", "delete"] },
  { module: "pulse_surveys", submodule: "my_surveys", actions: ["view", "create", "update", "delete"] },
  { module: "pulse_surveys", submodule: "feedback", actions: ["view", "create", "update", "delete"] },
];

const buildEmployeeDefaultModules = () => {
  const modules = createCatalogModules(emptyPermissions());

  EMPLOYEE_DEFAULTS.forEach(({ module, submodule, actions }) => {
    if (submodule) {
      setSubmodulePermissions(modules, module, submodule, actions);
      return;
    }
    setModulePermissions(modules, module, actions);
  });

  return modules;
};

const buildFullAccessModules = () => createCatalogModules(enabledPermissions());

const getDefaultModulesForRoleName = (roleName) => {
  const normalizedRoleName = String(roleName || "").trim().toLowerCase();

  if (normalizedRoleName === "employee") {
    return buildEmployeeDefaultModules();
  }

  if (normalizedRoleName === "ceo") {
    return buildFullAccessModules();
  }

  return null;
};

module.exports = {
  buildEmployeeDefaultModules,
  buildFullAccessModules,
  getDefaultModulesForRoleName,
};
