const express = require('express');
const {
  getAllCompanies,
  getAllTickets,
  getDashboardStats,
  getTicketsByOrganization,
  getOrganizationStats
} = require('../controllers/superAdminController');
const { protect, adminOnly } = require('../middleware/authMiddleware');

const router = express.Router();

// All routes require authentication and admin access
router.use(protect);
router.use(adminOnly);

// GET /api/superadmin/stats - Get dashboard statistics
router.get('/stats', getDashboardStats);

// GET /api/superadmin/organization-stats - Get organization statistics with subscription details
router.get('/organization-stats', getOrganizationStats);

// GET /api/superadmin/companies - Get all companies with user counts
router.get('/companies', getAllCompanies);

// GET /api/superadmin/tickets - Get all tickets with organization details
router.get('/tickets', getAllTickets);

// GET /api/superadmin/organizations/:id/tickets - Get tickets by organization ID
router.get('/organizations/:id/tickets', getTicketsByOrganization);

module.exports = router;
