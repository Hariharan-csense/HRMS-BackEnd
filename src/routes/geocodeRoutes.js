const express = require("express");
const router = express.Router();

const { protect } = require("../middleware/authMiddleware");
const { reverseGeocode } = require("../controllers/geocodeController");

router.use(protect);

// GET /api/geocode/reverse?lat=..&lng=..
router.get("/reverse", reverseGeocode);

module.exports = router;

