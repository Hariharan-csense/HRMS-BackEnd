const express = require("express");
const router = express.Router();
const {
  saveEmployeeLocation,
  getEmployeeLocations,
  getEmployeeLocationHistory,
  stopTracking,
} = require("../controllers/locationTrackingController");
const { protect, adminOnly } = require("../middleware/authMiddleware");
const { requirePermission } = require("../middleware/rbacMiddleware");

// Apply auth middleware to all routes
router.use(protect);

// POST /api/locations - Save location from employee device
router.post("/", saveEmployeeLocation);

// GET /api/locations - Get all current locations (admin only)
router.get("/", adminOnly, getEmployeeLocations);

// GET /api/locations/:employeeId/history - Get location history (admin only)
router.get("/:employeeId/history", adminOnly, getEmployeeLocationHistory);

// PUT /api/locations/:employeeId/stop - Stop tracking (admin only)
router.put("/:employeeId/stop", adminOnly, stopTracking);

module.exports = router;
