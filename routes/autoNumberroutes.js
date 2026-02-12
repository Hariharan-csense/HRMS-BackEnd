const express = require('express');
const router = express.Router();
const {
  getAutoNumbers,
  createAutoNumber,
  updateAutoNumber,
  deleteAutoNumber
} = require('../controllers/autoNumbercontroller');

const { protect, adminOnly } = require('../middleware/authMiddleware');

// Apply authentication middleware first
router.use(protect);

// Apply admin-only middleware
router.use(adminOnly);

router.get('/', getAutoNumbers);          // GET all auto numbers
router.post('/', createAutoNumber);       // POST create auto number
router.put('/:id', updateAutoNumber);     // PUT update auto number
router.delete('/:id', deleteAutoNumber);  // DELETE auto number

module.exports = router;
