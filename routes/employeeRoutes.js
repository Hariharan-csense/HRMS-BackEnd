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
const { checkUserCreationSubscription } = require('../middleware/subscriptionMiddleware');
const employeeUpload = require('../middleware/employeeUpload');

const router = express.Router();

// Add employee - with subscription verification
router.post('/add', protect, adminOnly, checkUserCreationSubscription, employeeUpload, addEmployee);

// Get all employees - with general subscription check
router.get('/', protect, getEmployees);

// Get employee by ID - with general subscription check
router.get('/:id', protect, getEmployeeById);

// Update employee - without subscription verification (updates should be allowed)
router.put('/:id', protect, adminOnly, employeeUpload, updateEmployee);

// Delete employee - with subscription verification
router.delete('/:id', protect, adminOnly, deleteEmployee);

module.exports = router;