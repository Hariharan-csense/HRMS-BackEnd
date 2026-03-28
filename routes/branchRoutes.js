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

const { protect } = require('../middleware/authMiddleware');
const { requirePermission } = require("../middleware/rbacMiddleware");

// Routes
router.post('/', protect, requirePermission("organization", "create", { submodule: "branches" }), addBranch);
router.get('/', protect, requirePermission("organization", "view", { submodule: "branches" }), getBranches);
router.put('/:id', protect, requirePermission("organization", "update", { submodule: "branches" }), updateBranch);
router.delete('/:id', protect, requirePermission("organization", "delete", { submodule: "branches" }), deleteBranch);





module.exports = router;
