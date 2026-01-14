const express = require('express');
const { getAllChecklists, updateChecklistItem } = require('../controllers/checklistController');
const { protect, adminOnly } = require('../middleware/authMiddleware'); // ✅ make sure correct path

const router = express.Router();

// All routes must go through protect middleware
router.get('/', protect,adminOnly, getAllChecklists);
router.put('/:id', protect,adminOnly, updateChecklistItem);

module.exports = router;
