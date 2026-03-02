// src/routes/roleRoutes.js
const express = require('express');
const {
  getPermissionCatalog,
  addRole,
  getRoles,
  updateRole,
  deleteRole,
  assignRoleToEmployee,
  removeRoleFromEmployee,
  getEmployeeRoles,
  getRoleAssignments
} = require('../controllers/roleController');
const { protect } = require('../middleware/authMiddleware');
const { requirePermission } = require("../middleware/rbacMiddleware");

const router = express.Router();

// Get all roles
router.get('/', protect, requirePermission("role_access", "view"), getRoles);

// RBAC catalog
router.get('/catalog', protect, requirePermission("role_access", "view"), getPermissionCatalog);

// Add role (Admin only)
router.post('/add', protect, requirePermission("role_access", "create"), addRole);

// Update role (Admin only)
router.put('/:id', protect, requirePermission("role_access", "update"), updateRole);

// Delete role (Admin only)
router.delete('/:id', protect, requirePermission("role_access", "delete"), deleteRole);

// Role Assignment Routes
// Assign role to employee (Admin only)
router.post('/assign', protect, requirePermission("role_access", "update"), assignRoleToEmployee);

// Remove role from employee (Admin only)
router.delete('/assignments/:id', protect, requirePermission("role_access", "update"), removeRoleFromEmployee);

// Get all role assignments for company (Admin only)
router.get('/assignments', protect, requirePermission("role_access", "view"), getRoleAssignments);

// Get specific employee's roles (Admin only)
router.get('/assignments/employee/:employee_id', protect, requirePermission("role_access", "view"), getEmployeeRoles);

module.exports = router;
