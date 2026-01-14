const express = require('express');

const {
  getAllResignations,
  createResignation,
  updateResignation
} = require('../controllers/resignationController');

const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

/* =========================
   RESIGNATION ROUTES
========================= */

// Get all resignations (company-wise)
router.get('/', protect, getAllResignations);

// Create resignation
router.post('/create', protect, createResignation);

// Update resignation
router.put('/:id', protect, updateResignation);

module.exports = router;
