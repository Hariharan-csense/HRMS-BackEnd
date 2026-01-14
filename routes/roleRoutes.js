// src/routes/roleRoutes.js
const express = require('express');
const {
  addRole,
  getRoles,
  updateRole,
  deleteRole
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

module.exports = router;