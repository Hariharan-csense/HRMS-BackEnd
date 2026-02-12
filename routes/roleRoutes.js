// src/routes/roleRoutes.js
const express = require('express');
const {
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

const router = express.Router();

// Get all roles
router.get('/', protect, getRoles);

// Add role (Admin only)
router.post('/add', protect, adminOnly, addRole);

// Update role (Admin only)
router.put('/:id', protect, adminOnly, updateRole);

// Delete role (Admin only)
router.delete('/:id', protect, adminOnly, deleteRole);

// Role Assignment Routes
// Assign role to employee (Admin only)
router.post('/assign', protect, adminOnly, assignRoleToEmployee);

// Remove role from employee (Admin only)
router.delete('/assignments/:id', protect, adminOnly, removeRoleFromEmployee);

// Get all role assignments for company (Admin only)
router.get('/assignments', protect, adminOnly, getRoleAssignments);

// Get specific employee's roles (Admin only)
router.get('/assignments/employee/:employee_id', protect, adminOnly, getEmployeeRoles);

module.exports = router;