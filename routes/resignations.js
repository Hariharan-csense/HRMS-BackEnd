const express = require('express');

const {
  getAllResignations,
  createResignation,
  updateResignation
} = require('../controllers/resignationController');

const { protect } = require('../middleware/authMiddleware');
const { requirePermission } = require("../middleware/rbacMiddleware");

const router = express.Router();

/* =========================
   RESIGNATION ROUTES
========================= */

// Get all resignations (company-wise)
router.get('/', protect, requirePermission("exit", "view", { submodule: "resignations" }), getAllResignations);

// Create resignation
router.post('/create', protect, requirePermission("exit", "create", { submodule: "resignations" }), createResignation);

// Update resignation
router.put('/:id', protect, requirePermission("exit", "update", { submodule: "resignations" }), updateResignation);

module.exports = router;
