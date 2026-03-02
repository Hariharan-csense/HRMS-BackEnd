const { RBAC_ACTIONS } = require("../config/rbacCatalog");

const normalizeKey = (value) => String(value || "").toLowerCase().replace(/[\s_-]+/g, "");

const findMatchingKey = (obj, wantedKey) => {
  if (!obj || typeof obj !== "object") return null;
  if (Object.prototype.hasOwnProperty.call(obj, wantedKey)) return wantedKey;

  const wantedNormalized = normalizeKey(wantedKey);
  return Object.keys(obj).find((k) => normalizeKey(k) === wantedNormalized) || null;
};

const normalizeAction = (action) => {
  const normalized = String(action || "").toLowerCase();
  if (normalized === "edit") return "update";
  return normalized;
};

const normalizePermissionSet = (rawPermission = {}) => {
  const output = {};
  RBAC_ACTIONS.forEach((action) => {
    if (action === "update") {
      const updateSource =
        rawPermission.update !== undefined ? rawPermission.update : rawPermission.edit;
      output.update = updateSource ? 1 : 0;
      return;
    }
    output[action] = rawPermission[action] ? 1 : 0;
  });

  // Backward compatibility for legacy frontend checks
  output.edit = output.update;
  return output;
};

const normalizeModuleEntry = (entry) => {
  if (!entry || typeof entry !== "object") {
    return {
      permissions: normalizePermissionSet({}),
      submodules: {},
    };
  }

  const explicitPermissions =
    entry.permissions && typeof entry.permissions === "object" ? entry.permissions : null;

  const basePermissions = normalizePermissionSet(explicitPermissions || entry);
  const submodules = {};
  const rawSubmodules =
    entry.submodules && typeof entry.submodules === "object" ? entry.submodules : {};

  Object.keys(rawSubmodules).forEach((subKey) => {
    const rawSubmoduleEntry = rawSubmodules[subKey];
    const subPermissionSource =
      rawSubmoduleEntry && typeof rawSubmoduleEntry === "object"
        ? rawSubmoduleEntry.permissions || rawSubmoduleEntry
        : {};
    submodules[subKey] = {
      permissions: normalizePermissionSet(subPermissionSource),
    };
  });

  return {
    permissions: basePermissions,
    submodules,
  };
};

const normalizeModulesPayload = (modules = {}) => {
  const normalized = {};
  Object.keys(modules || {}).forEach((moduleKey) => {
    normalized[moduleKey] = normalizeModuleEntry(modules[moduleKey]);
  });
  return normalized;
};

const parseModulesFromDb = (modulesValue) => {
  if (!modulesValue) return {};
  if (typeof modulesValue === "object") {
    return normalizeModulesPayload(modulesValue);
  }

  try {
    const parsed = JSON.parse(modulesValue);
    return normalizeModulesPayload(parsed);
  } catch (error) {
    return {};
  }
};

const hasPermission = ({ modules = {}, moduleKey, action, submoduleKey }) => {
  const wantedAction = normalizeAction(action);
  if (!RBAC_ACTIONS.includes(wantedAction)) return false;

  const matchedModuleKey = findMatchingKey(modules, moduleKey);
  if (!matchedModuleKey) return false;

  const moduleEntry = normalizeModuleEntry(modules[matchedModuleKey]);

  if (submoduleKey) {
    const matchedSubmoduleKey = findMatchingKey(moduleEntry.submodules, submoduleKey);
    if (matchedSubmoduleKey) {
      const submodulePermissions = moduleEntry.submodules[matchedSubmoduleKey]?.permissions || {};
      return Number(submodulePermissions[wantedAction] || 0) === 1;
    }
  }

  return Number(moduleEntry.permissions[wantedAction] || 0) === 1;
};

module.exports = {
  RBAC_ACTIONS,
  normalizeAction,
  normalizePermissionSet,
  normalizeModulesPayload,
  parseModulesFromDb,
  hasPermission,
  normalizeKey,
};
