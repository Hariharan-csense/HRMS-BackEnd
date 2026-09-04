const knex = require("../db/db");
const { hasPermission, parseModulesFromDb } = require("../utils/rbac");

const isSuperAdmin = (user) => {
  const roles = Array.isArray(user?.roles) ? user.roles : [];
  const hasSuperAdminRole = roles.some((r) => String(r || "").toLowerCase() === "superadmin");
  return hasSuperAdminRole || String(user?.role || "").toLowerCase() === "superadmin";
};

const isAdmin = (user) => {
  const primaryRole = String(user?.role || "").toLowerCase();
  const accountType = String(user?.type || "").toLowerCase();
  // Trust only the primary account identity for full access. This supports
  // Admin/CEO records stored in either users or employees without allowing an
  // ordinary Employee's additional role assignment to become a bypass.
  if (["admin", "ceo"].includes(primaryRole) || accountType === "admin") {
    return true;
  }
  if (accountType === "employee") return false;
  const roles = Array.isArray(user?.roles) ? user.roles : [];
  const authorityRoles = new Set(["admin", "ceo"]);
  const hasAdminRole = roles.some((r) =>
    authorityRoles.has(String(r || "").toLowerCase()),
  );
  return hasAdminRole;
};

const isTopAuthority = (user) => isSuperAdmin(user);

const hasDefaultAdminAccess = (user, moduleKey, submoduleKey) => {
  // Saved role permissions are authoritative. COMP050 Admin/CEO full access is
  // handled separately by isInternalCompanyAdmin.
  return false;
};

const getRoleNamesFromUser = (user) => {
  const roleNames = new Set();
  const primaryRole = String(user?.role || "").trim().toLowerCase();
  if (primaryRole) roleNames.add(primaryRole);

  if (
    primaryRole &&
    !["employee", "admin", "ceo", "superadmin"].includes(primaryRole)
  ) {
    return [primaryRole];
  }

  // For employee-scoped users, role assignments are loaded from the DB below.
  // Do not trust stale token/localStorage role arrays for permission decisions.
  if (String(user?.type || "").toLowerCase() !== "employee" && Array.isArray(user?.roles)) {
    user.roles.forEach((roleName) => {
      if (roleName) roleNames.add(String(roleName).toLowerCase());
    });
  }

  return [...roleNames];
};

const hasCustomRoleName = (roleNames = []) => {
  const systemRoles = new Set(["employee", "admin", "ceo", "superadmin"]);
  return roleNames.some(
    (roleName) => !systemRoles.has(String(roleName || "").toLowerCase()),
  );
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

    const assignedRoleNames = assignedRoles.map((role) =>
      String(role?.name || "").toLowerCase(),
    );
    if (hasCustomRoleName(assignedRoleNames)) {
      return aggregatedRoles;
    }
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
    isAdmin: isAdmin(req.user),
    effectiveRoles: [],
  };

  if (!context.isTopAuthority && !context.isAdmin) {
    context.effectiveRoles = await fetchEffectiveRoles(req.user);
  }

  req.rbacContext = context;
  return context;
};

const requirePermission = (moduleKey, action, options = {}) => {
  return async (req, res, next) => {
    try {
      const context = await resolveRbacContext(req);
      if (context.isTopAuthority || context.isAdmin) return next();
      if (hasDefaultAdminAccess(req.user, moduleKey, options.submodule)) return next();

      // Pulse self-service pages should be available to employees; controller logic still
      // verifies the employee is invited to the requested survey before returning data.
      const isPulseEmployeeSelfService =
        String(moduleKey).toLowerCase() === "pulse_surveys" &&
        ["my_surveys", "feedback", "respond"].includes(
          String(options.submodule || "").toLowerCase(),
        ) &&
        ["view", "create", "update"].includes(String(action).toLowerCase());
      if (
        isPulseEmployeeSelfService &&
        (req.user?.employee_id ||
          String(req.user?.type || "").toLowerCase() === "employee")
      ) {
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
      if (context.isTopAuthority || context.isAdmin) return next();
      for (const requiredPermission of permissions) {
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
