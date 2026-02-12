// routes/activityRoutes.js
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  getActivities,
  logActivity
} = require('../controllers/activityController');

// 🔐 All routes protected by token
router.use(protect);

// GET user activities
router.get('/', getActivities);

// POST log new activity
router.post('/', logActivity);

module.exports = router;
