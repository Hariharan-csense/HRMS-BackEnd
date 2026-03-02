const express = require('express');
const router = express.Router();
const {
  updateClientGeoFence,
  checkGeoFence,
  getClientsWithGeoFence,
  checkInWithGeoFence,
  checkOutWithGeoFence
} = require('../controllers/geoFenceController');
const { protect, adminOnly } = require('../middleware/authMiddleware');
const { requirePermission } = require("../middleware/rbacMiddleware");

// Apply auth middleware to all routes
router.use(protect);

// PUT /api/geo-fence/client/:id - Update client geo-fence (admin only)
router.put('/client/:id', requirePermission("client_attendance_admin", "update"), updateClientGeoFence);

// GET /api/geo-fence/clients - Get all clients with geo-fence status (admin only)
router.get('/clients', requirePermission("client_attendance_admin", "view"), getClientsWithGeoFence);

// POST /api/geo-fence/check - Check if within geo-fence
router.post('/check', requirePermission("client_attendance", "view"), checkGeoFence);

// POST /api/geo-fence/checkin - Enhanced check-in with geo-fence validation
router.post('/checkin', requirePermission("client_attendance", "create"), checkInWithGeoFence);

// POST /api/geo-fence/checkout/:id - Enhanced check-out with geo-fence validation
router.post('/checkout/:id', requirePermission("client_attendance", "update"), checkOutWithGeoFence);

module.exports = router;
