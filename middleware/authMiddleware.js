  // src/middleware/authMiddleware.js
  const jwt = require('jsonwebtoken');
  const knex = require('../db/db');

  const parseCookies = (cookieHeader = '') => {
    return String(cookieHeader || '')
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .reduce((acc, part) => {
        const separatorIndex = part.indexOf('=');
        if (separatorIndex === -1) {
          return acc;
        }

        const key = part.slice(0, separatorIndex).trim();
        const value = part.slice(separatorIndex + 1).trim();
        if (key) {
          acc[key] = decodeURIComponent(value);
        }
        return acc;
      }, {});
  };

  const normalizeRole = (role) => String(role || '').toLowerCase().trim();

  const buildRoleSet = (userLike = {}) => {
    const roles = new Set();
    const primary = normalizeRole(userLike.role);
    if (primary) roles.add(primary);

    if (Array.isArray(userLike.roles)) {
      userLike.roles
        .map(normalizeRole)
        .filter(Boolean)
        .forEach((role) => roles.add(role));
    }

    return roles;
  };

  const hasAnyRole = (userLike, allowedRoles = []) => {
    const roleSet = buildRoleSet(userLike);
    const normalizedAllowedRoles = allowedRoles.map(normalizeRole);
    if (normalizedAllowedRoles.includes('employee')) {
      const privilegedRoles = new Set(['admin', 'manager', 'hr', 'ceo', 'superadmin', 'finance']);
      const isEmployeeType = String(userLike?.type || '').toLowerCase().trim() === 'employee';
      const hasPrivilegedRole = [...roleSet].some((role) => privilegedRoles.has(role));
      if (isEmployeeType && !hasPrivilegedRole) {
        return true;
      }
    }
    return normalizedAllowedRoles.some((role) => roleSet.has(role));
  };

    const protect = async (req, res, next) => {
    let token;

    if (req.headers.authorization?.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      const cookies = parseCookies(req.headers.cookie);
      token = cookies.accessToken;
    }

    if (!token) {
      return res.status(401).json({ message: 'Not authorized, no token' });
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // Only allow access tokens for protected routes
      if (decoded.tokenType && decoded.tokenType !== 'access') {
        return res.status(401).json({ message: 'Invalid token type' });
      }

      let user = null;
      let userType = null;
      let companyId = null;
      let mappedEmployeeId = null;
      let mappedDepartmentId = null;
      let mappedDesignationId = null;

      // 1. Admin login (from users table)
      if (decoded.type === 'admin') {
        user = await knex('users')
          .where({ id: decoded.id })
          .first();

        if (!user) {
          return res.status(401).json({ message: 'Admin user not found' });
        }

        userType = 'admin';
        companyId = user.company_id; // may be null for super admin (if you have)

        // Map admin users.id -> employees.id (same email, same company) when available
        if (companyId && user.email) {
          const employeeProfile = await knex('employees')
            .where({ company_id: companyId })
            .whereRaw('LOWER(email) = ?', [String(user.email).toLowerCase().trim()])
            .first();
          if (employeeProfile) {
            mappedEmployeeId = Number(employeeProfile.id);
            mappedDepartmentId = employeeProfile.department_id || null;
            mappedDesignationId = employeeProfile.designation_id || null;
          }
        }
      } 
      // 2. Employee/Manager/HR login (from employees table)
      else if (decoded.type === 'employee') {
        user = await knex('employees')
          .where({ id: decoded.id })
          .first();

        if (!user) {
          // Fallback: id may be stale; resolve by token email + company
          if (decoded.company_id && decoded.email) {
            user = await knex('employees')
              .where({ company_id: decoded.company_id })
              .whereRaw('LOWER(email) = ?', [String(decoded.email).toLowerCase().trim()])
              .first();
          }
        }

        if (!user) {
          return res.status(401).json({ message: 'Employee not found' });
        }

        if (!user.company_id) {
          return res.status(403).json({ message: 'Employee not assigned to any company' });
        }

        userType = 'employee';
        companyId = user.company_id;
        mappedEmployeeId = Number(user.id);
        mappedDepartmentId = user.department_id || null;
        mappedDesignationId = user.designation_id || null;
      } else {
        return res.status(401).json({ message: 'Invalid user type' });
      }

      // Attach full user info to req.user
      const decodedRole = normalizeRole(decoded.role);
      const decodedRoles = Array.isArray(decoded.roles)
        ? decoded.roles.map(normalizeRole).filter(Boolean)
        : [];
      const persistedRole = normalizeRole(user.role) || 'employee';
      const effectiveRole = decodedRole || persistedRole;
      const mergedRoles = [...new Set([effectiveRole, persistedRole, ...decodedRoles].filter(Boolean))];
      req.user = {
        id: user.id,
        employee_id: mappedEmployeeId,
        email: user.email,
        role: effectiveRole,
        roles: mergedRoles,
        type: userType,
        company_id: companyId,
        department_id:
          mappedDepartmentId || user.department_id || decoded.department_id || null,
        designation_id:
          mappedDesignationId || user.designation_id || decoded.designation_id || null,
        first_name: user.first_name || null,
        last_name: user.last_name || null,
        name: user.first_name 
          ? `${user.first_name} ${user.last_name || ''}`.trim()
          : user.name || 'User'
      };

      next();

    } catch (error) {
      console.error('Token verification error:', error.message);
      if (error.name === 'TokenExpiredError') {
        return res.status(401).json({ message: 'Token expired' });
      }
      return res.status(401).json({ message: 'Invalid token' });
    }
  };

  // Admin Only Middleware
  const adminOnly = (req, res, next) => {
    if (!hasAnyRole(req.user, ['admin', 'superadmin'])) {
      return res.status(403).json({ message: 'Access denied. Admin only.' });
    }
    next();
  };

  // Super Admin Only Middleware
  const superAdminOnly = (req, res, next) => {
    if (!hasAnyRole(req.user, ['superadmin'])) {
      return res.status(403).json({ message: 'Access denied. Superadmin access required.' });
    }
    next();
  };

  // Optional: HR Only
  const hrOnly = (req, res, next) => {
    if (!hasAnyRole(req.user, ['admin', 'hr', 'superadmin'])) {
      return res.status(403).json({ message: 'Access denied. HR or Admin only.' });
    }
    next();
  };

  // Optional: Manager Only
  const managerOnly = (req, res, next) => {
    if (!hasAnyRole(req.user, ['admin', 'manager', 'superadmin'])) {
      return res.status(403).json({ message: 'Access denied. Manager or Admin only.' });
    }
    next();
  };

  // Optional: Finance Only
  const financeOnly = (req, res, next) => {
    if (!hasAnyRole(req.user, ['admin', 'finance', 'superadmin'])) {
      return res.status(403).json({ message: 'Access denied. Finance or Admin only.' });
    }
    next();
  };

  // Flexible role-based middleware
  const restrictTo = (...allowedRoles) => {
    return (req, res, next) => {
      if (!hasAnyRole(req.user, allowedRoles)) {
        return res.status(403).json({ 
          message: `Access denied. Required roles: ${allowedRoles.join(', ')}. Your role: ${req.user.role}` 
        });
      }
      next();
    };
  };

  module.exports = {
    protect,
    adminOnly,
    superAdminOnly,
    hrOnly,
    managerOnly,
    financeOnly,
    restrictTo,
    hasAnyRole
  };
