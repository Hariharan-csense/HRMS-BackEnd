// src/routes/companyRoutes.js
const express = require('express');
const multer = require('multer');
// Correct
const { createCompany, updateCompany, getCompany, deleteCompany } = require('../controllers/companyController');
const { protect } = require('../middleware/authMiddleware');
const upload = require('../middleware/upload'); // Multer for logo
const { requirePermission } = require("../middleware/rbacMiddleware");

const router = express.Router();

const handleLogoUpload = (req, res, next) => {
  upload(req, res, (err) => {
    if (!err) return next();

    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          success: false,
          message: 'Logo size exceeds 5MB limit'
        });
      }

      return res.status(400).json({
        success: false,
        message: err.message || 'Invalid logo upload request'
      });
    }

    return res.status(400).json({
      success: false,
      message: err.message || 'Invalid logo file. Please upload JPG/PNG/WebP/SVG under 5MB'
    });
  });
};

// Create (first time - no token)
router.post('/create', handleLogoUpload, createCompany);

// Update (admin only)
router.put('/update', protect, requirePermission("organization", "update", { submodule: "company" }), handleLogoUpload, updateCompany);

// Get company
router.get('/', protect, requirePermission("organization", "view", { submodule: "company" }), getCompany);

// DELETE COMPANY - Admin only + logo file delete
router.delete('/delete', protect, requirePermission("organization", "delete", { submodule: "company" }), deleteCompany);

module.exports = router;
