const express = require('express');
const router = express.Router();
const organizationController = require('../controllers/organizationController');
const { protect } = require('../middleware/authMiddleware');
const { requirePermission } = require("../middleware/rbacMiddleware");

// Apply auth middleware to all routes
router.use(protect);

// Organization routes
router.get('/', requirePermission("organizations", "view"), organizationController.getOrganizations);
router.get('/:id', requirePermission("organizations", "view"), organizationController.getOrganizationById);
router.post('/', requirePermission("organizations", "create"), organizationController.createOrganization);
router.put('/:id', requirePermission("organizations", "update"), organizationController.updateOrganization);
router.delete('/:id', requirePermission("organizations", "delete"), organizationController.deleteOrganization);

module.exports = router;
