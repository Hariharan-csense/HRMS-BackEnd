// src/routes/employeeRoutes.js
const express = require('express');
const multer = require('multer');
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

const handleEmployeeUpload = (req, res, next) => {
  employeeUpload(req, res, (err) => {
    if (!err) return next();

    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          success: false,
          message: 'One or more files exceed 10MB limit'
        });
      }

      if (err.code === 'LIMIT_UNEXPECTED_FILE') {
        return res.status(400).json({
          success: false,
          message: `Unexpected file field: ${err.field || 'unknown'}`
        });
      }

      return res.status(400).json({
        success: false,
        message: err.message || 'Invalid employee document upload'
      });
    }

    return res.status(400).json({
      success: false,
      message: err.message || 'Invalid file type. Allowed: JPG, PNG, PDF'
    });
  });
};

// Add employee - with subscription verification
router.post('/add', protect, adminOnly, checkUserCreationSubscription, handleEmployeeUpload, addEmployee);

// Get all employees - with general subscription check
router.get('/', protect, getEmployees);

// Get employee by ID - with general subscription check
router.get('/:id', protect, getEmployeeById);

// Update employee - without subscription verification (updates should be allowed)
router.put('/:id', protect, adminOnly, handleEmployeeUpload, updateEmployee);

// Delete employee - with subscription verification
router.delete('/:id', protect, adminOnly, deleteEmployee);

module.exports = router;
