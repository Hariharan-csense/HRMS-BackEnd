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
const { protect, adminOnly } = require('../middleware/authMiddleware');
const { } = require("../middleware/rbacMiddleware");

const router = express.Router();

// Get all roles
router.get('/', protect, getRoles);

// RBAC catalog
router.get('/catalog', protect, getPermissionCatalog);

// Add role (Admin only)
router.post('/add', protect, addRole);

// Update role (Admin only)
router.put('/:id', protect, updateRole);

// Delete role (Admin only)
router.delete('/:id', protect, deleteRole);

// Role Assignment Routes
// Assign role to employee (Admin only)
router.post('/assign', protect, assignRoleToEmployee);

// Remove role from employee (Admin only)
router.delete('/assignments/:id', protect, removeRoleFromEmployee);

// Get all role assignments for company (Admin only)
router.get('/assignments', protect, getRoleAssignments);

// Get specific employee's roles (Admin only)
router.get('/assignments/employee/:employee_id', protect, getEmployeeRoles);

module.exports = router;
