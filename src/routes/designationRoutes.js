// src/routes/designationRoutes.js
const express = require('express');
const {
  addDesignation,
  getDesignations,
  updateDesignation,
  deleteDesignation
} = require('../controllers/designationController');
const { protect } = require('../middleware/authMiddleware');
const { requirePermission } = require("../middleware/rbacMiddleware");

const router = express.Router();

// Get all designations (any logged-in user)
router.get('/', protect, requirePermission("organization", "view", { submodule: "designations" }), getDesignations);

// Add designation (Admin only)
router.post('/add', protect, requirePermission("organization", "create", { submodule: "designations" }), addDesignation);

// Update designation (Admin only)
router.put('/:id', protect, requirePermission("organization", "update", { submodule: "designations" }), updateDesignation);

// Delete designation (Admin only)
router.delete('/:id', protect, requirePermission("organization", "delete", { submodule: "designations" }), deleteDesignation);

module.exports = router;
