// src/routes/companyRoutes.js
const express = require('express');
// Correct
const { createCompany, updateCompany, getCompany, deleteCompany } = require('../controllers/companyController');
const { protect, adminOnly } = require('../middleware/authMiddleware');
const upload = require('../middleware/upload'); // Multer for logo

const router = express.Router();

// Create (first time - no token)
router.post('/create', upload, createCompany);

// Update (admin only)
router.put('/update', protect, adminOnly, upload, updateCompany);

// Get company
router.get('/', protect, getCompany);

// DELETE COMPANY - Admin only + logo file delete
router.delete('/delete', protect, adminOnly, deleteCompany);

module.exports = router;