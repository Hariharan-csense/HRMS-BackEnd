const express = require('express');
const { getAdminDashboardData, getEmployeeDashboardData, getManagerDashboardData, getHRDashboardData, getFinanceDashboardData } = require('../controllers/dashboardController');
const { protect } = require('../middleware/authMiddleware');
const { requirePermission } = require("../middleware/rbacMiddleware");
const router = express.Router();

/**
 * @route   GET /api/admin/dashboard
 * @desc    Get all data required for the Admin Dashboard (single endpoint for efficiency)
 * @access  Private (Admin) - add your auth middleware as needed
 */
router.get('/admin-dashboard',protect, requirePermission("dashboard", "view"), getAdminDashboardData);

/**
 * @route   GET /api/admin/employee-dashboard
 * @desc    Get all data required for the Employee Dashboard
 * @access  Private (Employee)
 */
router.get('/employee-dashboard', protect, requirePermission("dashboard", "view"), getEmployeeDashboardData);

/**
 * @route   GET /api/admin/manager-dashboard
 * @desc    Get all data required for the Manager Dashboard
 * @access  Private (Manager)
 */
router.get('/manager-dashboard', protect, requirePermission("dashboard", "view"), getManagerDashboardData);

/**
 * @route   GET /api/admin/hr-dashboard
 * @desc    Get all data required for the HR Dashboard
 * @access  Private (HR)
 */
router.get('/hr-dashboard', protect, requirePermission("dashboard", "view"), getHRDashboardData);

/**
 * @route   GET /api/admin/finance-dashboard
 * @desc    Get all data required for the Finance Dashboard
 * @access  Private (Finance)
 */
router.get('/finance-dashboard', protect, requirePermission("dashboard", "view"), getFinanceDashboardData);

module.exports = router;
