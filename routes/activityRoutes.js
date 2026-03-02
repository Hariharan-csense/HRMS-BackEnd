// routes/activityRoutes.js
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { requirePermission } = require("../middleware/rbacMiddleware");
const {
  getActivities,
  logActivity
} = require('../controllers/activityController');

// 🔐 All routes protected by token
router.use(protect);

// GET user activities
router.get('/', requirePermission("employees", "view", { submodule: "profile" }), getActivities);

// POST log new activity
router.post('/', requirePermission("employees", "create", { submodule: "profile" }), logActivity);

module.exports = router;
