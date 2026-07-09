const knex = require("../db/db");
const { hasPermission, parseModulesFromDb } = require("../utils/rbac");
const {
  companyHasActiveAddonModule,
  employeeHasAddonModuleAssignment,
} = require("../utils/subscriptionAddons");

const isSuperAdmin = (user) => {
  const roles = Array.isArray(user?.roles) ? user.roles : [];
  const hasSuperAdminRole = roles.some((r) => String(r || "").toLowerCase() === "superadmin");
  return hasSuperAdminRole || String(user?.role || "").toLowerCase() === "superadmin";
};

const isCeo = (user) => {
  const roles = Array.isArray(user?.roles) ? user.roles : [];
  const hasCeoRole = roles.some((r) => String(r || "").toLowerCase() === "ceo");
  return hasCeoRole || String(user?.role || "").toLowerCase() === "ceo";
};

const isTopAuthority = (user) => isSuperAdmin(user) || isCeo(user);

const isCompanyAdmin = (user) => {
  const roleNames = getRoleNamesFromUser(user);
  return roleNames.includes("admin") || roleNames.includes("ceo");
};

const hasAddonAccess = async (user, moduleKey) => {
  if (!user?.company_id) return false;
  const hasCompanyAddon = await companyHasActiveAddonModule(user.company_id, moduleKey);
  if (!hasCompanyAddon) return false;

  // Admin/CEO can manage/monitor purchased add-on modules for the company.
  if (isCompanyAdmin(user)) return true;

  return employeeHasAddonModuleAssignment(
    user.company_id,
    user.employee_id || user.id,
    moduleKey
  );
};

const hasDefaultAdminAccess = (user, moduleKey, submoduleKey) => {
  const roleNames = getRoleNamesFromUser(user);
  const isAdmin = roleNames.includes("admin");
  if (!isAdmin) return false;

  const normalizedModule = String(moduleKey || "").toLowerCase();
  const normalizedSubmodule = String(submoduleKey || "").toLowerCase();

  if (normalizedModule === "payroll") return true;
  if (normalizedModule === "kpi") return true;
  if (normalizedModule === "employees" && normalizedSubmodule === "profile") return true;
  if (normalizedModule === "expenses" && normalizedSubmodule === "claims") return true;
  if (
    normalizedModule === "pulse_surveys" &&
    ["my_surveys", "feedback", "respond"].includes(normalizedSubmodule)
  ) {
    return true;
  }

  return false;
};

const getRoleNamesFromUser = (user) => {
  const roleNames = new Set();
  if (user?.role) roleNames.add(String(user.role).toLowerCase());

  if (Array.isArray(user?.roles)) {
    user.roles.forEach((roleName) => {
      if (roleName) roleNames.add(String(roleName).toLowerCase());
    });
  }

  return [...roleNames];
};

const fetchEffectiveRoles = async (user) => {
  if (!user?.company_id) return [];

  const aggregatedRoles = [];
  const seenRoleNames = new Set();
  const appendRole = (roleRecord) => {
    const roleName = String(roleRecord?.name || "").toLowerCase();
    if (!roleName || seenRoleNames.has(roleName)) return;
    seenRoleNames.add(roleName);
    aggregatedRoles.push({
      ...roleRecord,
      modules: parseModulesFromDb(roleRecord.modules),
    });
  };

  if (user.type === "employee" && user.id) {
    const assignedRoles = await knex("role_assignments")
      .join("roles", "role_assignments.role_id", "roles.id")
      .where({
        "role_assignments.employee_id": user.id,
        "role_assignments.company_id": user.company_id,
        "role_assignments.status": "Active",
      })
      .select("roles.id", "roles.name", "roles.modules");

    assignedRoles.forEach(appendRole);
  }

  const roleNames = getRoleNamesFromUser(user);
  if (roleNames.length > 0) {
    const companyRoles = await knex("roles")
      .where({ company_id: user.company_id })
      .select("id", "name", "modules");

    companyRoles.forEach((roleRecord) => {
      if (roleNames.includes(String(roleRecord.name || "").toLowerCase())) {
        appendRole(roleRecord);
      }
    });
  }

  return aggregatedRoles;
};

const resolveRbacContext = async (req) => {
  if (req.rbacContext) return req.rbacContext;

  const context = {
    isTopAuthority: isTopAuthority(req.user),
    effectiveRoles: [],
  };

  if (!context.isTopAuthority) {
    context.effectiveRoles = await fetchEffectiveRoles(req.user);
  }

  req.rbacContext = context;
  return context;
};

const requirePermission = (moduleKey, action, options = {}) => {
  return async (req, res, next) => {
    try {
      const context = await resolveRbacContext(req);
      if (context.isTopAuthority) return next();
      if (await hasAddonAccess(req.user, moduleKey)) return next();
      if (hasDefaultAdminAccess(req.user, moduleKey, options.submodule)) return next();

      // Allow authenticated users with an employee profile to respond to pulse surveys even if the role
      // assignment is missing the explicit "respond" permission. Responding should be
      // available to anyone invited to a survey.
      const isPulseRespond =
        String(moduleKey).toLowerCase() === "pulse_surveys" &&
        String(options.submodule || "").toLowerCase() === "respond" &&
        ["create", "update"].includes(String(action).toLowerCase());
      if (isPulseRespond && (req.user?.employee_id || String(req.user?.type || "").toLowerCase() === "employee")) {
        return next();
      }

      const allowed = context.effectiveRoles.some((roleRecord) =>
        hasPermission({
          modules: roleRecord.modules,
          moduleKey,
          action,
          submoduleKey: options.submodule,
        })
      );

      if (!allowed) {
        return res.status(403).json({
          success: false,
          message: `Access denied for ${moduleKey}${options.submodule ? `/${options.submodule}` : ""} (${action})`,
        });
      }

      return next();
    } catch (error) {
      console.error("RBAC permission check failed:", error);
      return res.status(500).json({ success: false, message: "RBAC permission check failed" });
    }
  };
};

const requireAnyPermission = (permissions = []) => {
  return async (req, res, next) => {
    try {
      const context = await resolveRbacContext(req);
      if (context.isTopAuthority) return next();
      for (const requiredPermission of permissions) {
        if (await hasAddonAccess(req.user, requiredPermission.module)) return next();
        if (
          hasDefaultAdminAccess(
            req.user,
            requiredPermission.module,
            requiredPermission.submodule
          )
        ) {
          return next();
        }
      }

      const allowed = context.effectiveRoles.some((roleRecord) =>
        permissions.some((requiredPermission) =>
          hasPermission({
            modules: roleRecord.modules,
            moduleKey: requiredPermission.module,
            action: requiredPermission.action,
            submoduleKey: requiredPermission.submodule,
          })
        )
      );

      if (!allowed) {
        return res.status(403).json({
          success: false,
          message: "Access denied for required permission set",
        });
      }

      return next();
    } catch (error) {
      console.error("RBAC any-permission check failed:", error);
      return res.status(500).json({ success: false, message: "RBAC permission check failed" });
    }
  };
};

module.exports = {
  requirePermission,
  requireAnyPermission,
};
