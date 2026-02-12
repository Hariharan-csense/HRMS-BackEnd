// src/routes/designationRoutes.js
const express = require('express');
const {
  addDesignation,
  getDesignations,
  updateDesignation,
  deleteDesignation
} = require('../controllers/designationController');
const { protect, adminOnly } = require('../middleware/authMiddleware');

const router = express.Router();

// Get all designations (any logged-in user)
router.get('/', protect, getDesignations);

// Add designation (Admin only)
router.post('/add', protect, adminOnly, addDesignation);

// Update designation (Admin only)
router.put('/:id', protect, adminOnly, updateDesignation);

// Delete designation (Admin only)
router.delete('/:id', protect, adminOnly, deleteDesignation);

module.exports = router;