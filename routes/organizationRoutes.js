const express = require('express');
const router = express.Router();
const organizationController = require('../controllers/organizationController');
const { protect } = require('../middleware/authMiddleware');

// Apply auth middleware to all routes
router.use(protect);

// Organization routes
router.get('/', organizationController.getOrganizations);
router.get('/:id', organizationController.getOrganizationById);
router.post('/', organizationController.createOrganization);
router.put('/:id', organizationController.updateOrganization);
router.delete('/:id', organizationController.deleteOrganization);

module.exports = router;
