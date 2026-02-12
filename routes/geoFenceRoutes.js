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

// Apply auth middleware to all routes
router.use(protect);

// PUT /api/geo-fence/client/:id - Update client geo-fence (admin only)
router.put('/client/:id', adminOnly, updateClientGeoFence);

// GET /api/geo-fence/clients - Get all clients with geo-fence status (admin only)
router.get('/clients', adminOnly, getClientsWithGeoFence);

// POST /api/geo-fence/check - Check if within geo-fence
router.post('/check', checkGeoFence);

// POST /api/geo-fence/checkin - Enhanced check-in with geo-fence validation
router.post('/checkin', checkInWithGeoFence);

// POST /api/geo-fence/checkout/:id - Enhanced check-out with geo-fence validation
router.post('/checkout/:id', checkOutWithGeoFence);

module.exports = router;
