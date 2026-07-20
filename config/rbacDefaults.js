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

const normalizeKey = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");

const findCatalogEntry = (entries, wanted) => {
  const normalizedWanted = normalizeKey(wanted);
  return (entries || []).find(
    (entry) =>
      normalizeKey(entry?.key) === normalizedWanted ||
      normalizeKey(entry?.label) === normalizedWanted,
  );
};

const resolveModuleKey = (moduleKeyOrLabel) =>
  findCatalogEntry(RBAC_MODULE_CATALOG, moduleKeyOrLabel)?.key ||
  moduleKeyOrLabel;

const resolveSubmoduleKey = (moduleKeyOrLabel, submoduleKeyOrLabel) => {
  const moduleEntry = findCatalogEntry(RBAC_MODULE_CATALOG, moduleKeyOrLabel);
  if (!moduleEntry) return submoduleKeyOrLabel;

  return (
    findCatalogEntry(moduleEntry.submodules || [], submoduleKeyOrLabel)?.key ||
    submoduleKeyOrLabel
  );
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
  const resolvedModuleKey = resolveModuleKey(moduleKey);
  if (!modules[resolvedModuleKey]) return;
  modules[resolvedModuleKey].permissions = enabledPermissions(actions);
};

const setSubmodulePermissions = (modules, moduleKey, submoduleKey, actions) => {
  const resolvedModuleKey = resolveModuleKey(moduleKey);
  const resolvedSubmoduleKey = resolveSubmoduleKey(moduleKey, submoduleKey);
  const submodule =
    modules[resolvedModuleKey]?.submodules?.[resolvedSubmoduleKey];
  if (!submodule) return;
  submodule.permissions = enabledPermissions(actions);
};

const findCurrentModuleKey = (modules, wantedModuleKey) =>
  Object.keys(modules || {}).find(
    (moduleKey) => resolveModuleKey(moduleKey) === wantedModuleKey,
  );

const findCurrentSubmoduleKey = (submodules, moduleKey, wantedSubmoduleKey) =>
  Object.keys(submodules || {}).find(
    (submoduleKey) =>
      resolveSubmoduleKey(moduleKey, submoduleKey) === wantedSubmoduleKey,
  );

const mergeDefaultModules = (currentModules = {}, defaultModules = {}) => {
  const mergedModules = {};

  RBAC_MODULE_CATALOG.forEach((moduleEntry) => {
    if (!moduleEntry?.key) return;

    const currentModuleKey = findCurrentModuleKey(
      currentModules,
      moduleEntry.key,
    );
    const currentModule = currentModuleKey
      ? currentModules[currentModuleKey]
      : null;
    const defaultModule = defaultModules[moduleEntry.key];

    const submodules = {};
    (moduleEntry.submodules || []).forEach((subEntry) => {
      if (!subEntry?.key) return;

      const currentSubmoduleKey = findCurrentSubmoduleKey(
        currentModule?.submodules,
        moduleEntry.key,
        subEntry.key,
      );
      const currentSubmodule = currentSubmoduleKey
        ? currentModule.submodules[currentSubmoduleKey]
        : null;
      const defaultSubmodule = defaultModule?.submodules?.[subEntry.key];

      submodules[subEntry.key] = {
        permissions: currentSubmodule
          ? {
              ...emptyPermissions(),
              ...currentSubmodule.permissions,
            }
          : {
              ...emptyPermissions(),
              ...(defaultSubmodule?.permissions || {}),
            },
      };
    });

    mergedModules[moduleEntry.key] = {
      permissions: currentModule
        ? {
            ...emptyPermissions(),
            ...currentModule.permissions,
          }
        : {
            ...emptyPermissions(),
            ...(defaultModule?.permissions || {}),
          },
      submodules,
    };
  });

  return mergedModules;
};

const EMPLOYEE_DEFAULTS = [
  { module: "dashboard", actions: ["view"] },
  {
    module: "employees",
    submodule: "profile",
    actions: ["view", "create", "update", "delete"],
  },
  {
    module: "client_attendance",
    actions: ["view", "create", "update", "delete"],
  },
  { module: "my_clients", actions: ["view", "create", "update", "delete"] },
  { module: "attendance", actions: ["view", "create", "update"] },
  {
    module: "attendance",
    submodule: "capture",
    actions: ["view", "create", "update", "delete"],
  },
  {
    module: "attendance",
    submodule: "facial_recognition",
    actions: ["view", "create"],
  },
  { module: "attendance", submodule: "log", actions: ["view"] },
  {
    module: "attendance",
    submodule: "override",
    actions: ["view", "create", "update", "delete", "approve", "reject"],
  },
  { module: "leave", actions: ["view", "create", "update", "delete"] },
  {
    module: "leave",
    submodule: "apply",
    actions: ["view", "create", "update"],
  },
  { module: "leave", submodule: "balance", actions: ["view"] },
  { module: "leave", submodule: "leave_types", actions: ["view"] },
  { module: "leave", submodule: "permission", actions: ["view", "create"] },
  { module: "payroll", submodule: "payslips", actions: ["view"] },
  { module: "expenses", actions: ["view", "create", "update", "delete"] },
  {
    module: "expenses",
    submodule: "claims",
    actions: ["view", "create", "update", "delete"],
  },
  { module: "pulse_surveys", actions: ["view", "create", "update", "delete"] },
  {
    module: "pulse_surveys",
    submodule: "my_surveys",
    actions: ["view", "create", "update", "delete"],
  },
  {
    module: "pulse_surveys",
    submodule: "feedback",
    actions: ["view", "create", "update", "delete"],
  },

  { module: "kpi", actions: ["view", "create", "update", "delete"] },
  { module: "kpi", submodule: "dashboard", actions: ["view"] },
  {
    module: "kpi",
    submodule: "scorecard",
    actions: ["view"],
  },
  {
    module: "kpi",
    submodule: "review",
    actions: ["view", "create", "update", "delete"],
  },
  {
    module: "kpi",
    submodule: "corrective_actions",
    actions: ["view", "create", "update", "delete"],
  },
  {
    module: "kpi",
    submodule: "reports",
    actions: ["view", "create", "update", "delete"],
  },
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
  const normalizedRoleName = String(roleName || "")
    .trim()
    .toLowerCase();

  if (normalizedRoleName === "employee") {
    return buildEmployeeDefaultModules();
  }

  if (normalizedRoleName === "admin" || normalizedRoleName === "ceo") {
    return buildFullAccessModules();
  }

  return null;
};

const mergeDefaultModulesForRoleName = (roleName, currentModules = {}) => {
  const defaultModules = getDefaultModulesForRoleName(roleName);
  if (!defaultModules) {
    return mergeDefaultModules(currentModules, {});
  }

  return mergeDefaultModules(currentModules, defaultModules);
};

module.exports = {
  buildEmployeeDefaultModules,
  buildFullAccessModules,
  getDefaultModulesForRoleName,
  mergeDefaultModulesForRoleName,
};
