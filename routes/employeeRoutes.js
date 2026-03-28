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
const { protect } = require('../middleware/authMiddleware');
const { checkUserCreationSubscription } = require('../middleware/subscriptionMiddleware');
const employeeUpload = require('../middleware/employeeUpload');
const { requirePermission } = require("../middleware/rbacMiddleware");

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
router.post('/add', protect, requirePermission("employees", "create", { submodule: "list" }), checkUserCreationSubscription, handleEmployeeUpload, addEmployee);

// Get all employees - with general subscription check
router.get('/', protect, requirePermission("employees", "view", { submodule: "list" }), getEmployees);

// Get employee by ID - with general subscription check
router.get('/:id', protect, requirePermission("employees", "view", { submodule: "profile" }), getEmployeeById);

// Update employee - without subscription verification (updates should be allowed)
router.put('/:id', protect, requirePermission("employees", "update", { submodule: "profile" }), handleEmployeeUpload, updateEmployee);

// Delete employee - with subscription verification
router.delete('/:id', protect, requirePermission("employees", "delete", { submodule: "list" }), deleteEmployee);

module.exports = router;
