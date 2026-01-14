// src/routes/adminDashboard.routes.js
const express = require('express');
const { getAdminDashboardData } = require('../controllers/dashboardController');
const { protect, adminOnly } = require('../middleware/authMiddleware');
const router = express.Router();

/**
 * @route   GET /api/admin/dashboard
 * @desc    Get all data required for the Admin Dashboard (single endpoint for efficiency)
 * @access  Private (Admin) - add your auth middleware as needed
 */
router.get('/admin-dashboard',protect, adminOnly, getAdminDashboardData);

module.exports = router;