  // src/middleware/authMiddleware.js
  const jwt = require('jsonwebtoken');
  const knex = require('../db/db');

    const protect = async (req, res, next) => {
    let token;

    if (req.headers.authorization?.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({ message: 'Not authorized, no token' });
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      let user = null;
      let userType = null;
      let companyId = null;

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
      } 
      // 2. Employee/Manager/HR login (from employees table)
      else if (decoded.type === 'employee') {
        user = await knex('employees')
          .where({ id: decoded.id })
          .first();

        if (!user) {
          return res.status(401).json({ message: 'Employee not found' });
        }

        if (!user.company_id) {
          return res.status(403).json({ message: 'Employee not assigned to any company' });
        }

        userType = 'employee';
        companyId = user.company_id;
      } else {
        return res.status(401).json({ message: 'Invalid user type' });
      }

      // Attach full user info to req.user
      req.user = {
        id: user.id,
        email: user.email,
        role: user.role || 'employee',
        type: userType,
        company_id: companyId, // ← மிக முக்கியம்! எல்லா controller-லயும் இதை use பண்ணுவோம்
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
    if (req.user.type !== 'admin') {
      return res.status(403).json({ message: 'Access denied. Admin only.' });
    }
    next();
  };

  // Super Admin Only Middleware
  const superAdminOnly = (req, res, next) => {
    if (req.user.role !== 'superadmin') {
      return res.status(403).json({ message: 'Access denied. Superadmin access required.' });
    }
    next();
  };

  // Optional: HR Only
  const hrOnly = (req, res, next) => {
    if (!['admin', 'hr'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Access denied. HR or Admin only.' });
    }
    next();
  };

  // Optional: Manager Only
  const managerOnly = (req, res, next) => {
    if (!['admin', 'manager'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Access denied. Manager or Admin only.' });
    }
    next();
  };

  // Optional: Finance Only
  const financeOnly = (req, res, next) => {
    if (!['admin', 'finance'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Access denied. Finance or Admin only.' });
    }
    next();
  };

  // Flexible role-based middleware
  const restrictTo = (...allowedRoles) => {
    return (req, res, next) => {
      if (!allowedRoles.includes(req.user.role)) {
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
    restrictTo
  };