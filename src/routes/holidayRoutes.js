// src/routes/holidayRoutes.js

const express = require('express');
const router = express.Router();

// Correct import - function names match exactly
const { 
  getAllHolidays, 
  createHoliday, 
  updateHoliday, 
  deleteHoliday 
} = require('../controllers/holidayController');

const { protect } = require('../middleware/authMiddleware');
const { requirePermission } = require("../middleware/rbacMiddleware");

// Routes
router.post('/', protect, requirePermission("leave", "create", { submodule: "config" }), createHoliday);
router.get('/', protect, requirePermission("leave", "view", { submodule: "config" }), getAllHolidays);
router.put('/:id', protect, requirePermission("leave", "update", { submodule: "config" }), updateHoliday);
router.delete('/:id', protect, requirePermission("leave", "delete", { submodule: "config" }), deleteHoliday);

module.exports = router;
