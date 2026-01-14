// src/routes/assetRoutes.js
const express = require('express');
const {
  addAsset,
  getAssets,
  updateAsset,
  deleteAsset
} = require('../controllers/assetController');
const { protect, adminOnly } = require('../middleware/authMiddleware');

const router = express.Router();

// Get all assets
router.get('/', protect, getAssets);

// Add asset (Admin only)
router.post('/add', protect, adminOnly, addAsset);

// Update asset (Admin only)
router.put('/:id', protect, adminOnly, updateAsset);

// Delete asset (Admin only)
router.delete('/:id', protect, adminOnly, deleteAsset);

module.exports = router;