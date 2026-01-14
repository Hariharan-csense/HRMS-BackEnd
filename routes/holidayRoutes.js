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

const { protect, adminOnly } = require('../middleware/authMiddleware');

// Routes
router.post('/', protect, adminOnly, createHoliday);        // Create holiday (admin only)
router.get('/', protect, getAllHolidays);                   // Get all holidays (authenticated users)
router.put('/:id', protect, adminOnly, updateHoliday);      // Update holiday (admin only)
router.delete('/:id', protect, adminOnly, deleteHoliday);   // Delete holiday (admin only)

module.exports = router;