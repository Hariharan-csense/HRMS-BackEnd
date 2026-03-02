// src/routes/assetRoutes.js
const express = require('express');
const {
  addAsset,
  getAssets,
  updateAsset,
  deleteAsset
} = require('../controllers/assetController');
const { protect } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/rbacMiddleware');

const router = express.Router();

// Get all assets
router.get('/', protect, requirePermission("assets", "view"), getAssets);

// Add asset (Admin only)
router.post('/add', protect, requirePermission("assets", "create"), addAsset);

// Update asset (Admin only)
router.put('/:id', protect, requirePermission("assets", "update"), updateAsset);

// Delete asset (Admin only)
router.delete('/:id', protect, requirePermission("assets", "delete"), deleteAsset);

module.exports = router;
