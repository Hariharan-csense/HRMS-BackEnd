// src/routes/branchRoutes.js
const express = require('express');
const router = express.Router();

// Correct import - function names match exactly
const { 
  addBranch, 
  getBranches, 
  updateBranch, 
  deleteBranch 
} = require('../controllers/branchController');

const { protect, adminOnly } = require('../middleware/authMiddleware');

// Routes
router.post('/', protect, adminOnly, addBranch);        // line ~17
router.get('/', protect, getBranches);
router.put('/:id', protect, adminOnly, updateBranch);
router.delete('/:id', protect, adminOnly, deleteBranch);

module.exports = router;