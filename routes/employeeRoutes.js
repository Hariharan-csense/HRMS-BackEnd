// src/routes/employeeRoutes.js
const express = require('express');
const {
  addEmployee,
  getEmployees,
  getEmployeeById,
  updateEmployee,
  deleteEmployee
} = require('../controllers/employeeController');
const { protect, adminOnly } = require('../middleware/authMiddleware');
const employeeUpload = require('../middleware/employeeUpload');

const router = express.Router();

// Add employee
router.post('/add', protect, adminOnly, employeeUpload, addEmployee);

// Get all employees
router.get('/', protect, getEmployees);

// Get employee by ID
router.get('/:id', protect, getEmployeeById);

// Update employee
router.put('/:id', protect, adminOnly, employeeUpload, updateEmployee);

// Delete employee
router.delete('/:id', protect, adminOnly, deleteEmployee);

module.exports = router;