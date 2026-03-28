// src/middleware/roleMiddleware.js

/**
 * Role-based access control middleware
 * Usage: restrictTo('admin', 'hr', 'finance')
 */
const restrictTo = (...allowedRoles) => {
  return (req, res, next) => {
    // protect middleware already ran → req.user exists
    const userRole = req.user.role?.toLowerCase();

    if (!userRole || !allowedRoles.map(r => r.toLowerCase()).includes(userRole)) {
      return res.status(403).json({
        success: false,
        message: `Access denied! Required roles: ${allowedRoles.join(', ')}. Your role: ${req.user.role || 'none'}`
      });
    }

    next();
  };
};

// Pre-defined common middlewares
const adminOnly = restrictTo('admin');

const adminOrHr = restrictTo('admin', 'hr');

const adminOrFinance = restrictTo('admin', 'finance');

const adminOrManager = restrictTo('admin', 'manager');

const adminHrFinance = restrictTo('admin', 'hr', 'finance');

const anyAuthenticated = (req, res, next) => next(); // for logged-in users only

module.exports = {
  restrictTo,          // flexible use
  adminOnly,
  adminOrHr,
  adminOrFinance,
  adminOrManager,
  adminHrFinance,
  anyAuthenticated
};