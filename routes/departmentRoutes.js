// src/routes/departmentRoutes.js
const express = require('express');
const {
  addDepartment,
  getDepartments,
  updateDepartment,
  deleteDepartment
} = require('../controllers/departmentController');
const { protect } = require('../middleware/authMiddleware');
const { requirePermission } = require("../middleware/rbacMiddleware");

const router = express.Router();


router.get('/public', getDepartments);

router.get('/', protect, requirePermission("organization", "view", { submodule: "departments" }), getDepartments);

// Add department (Admin only)
router.post('/add', protect, requirePermission("organization", "create", { submodule: "departments" }), addDepartment);

// Update department (Admin only)
router.put('/:id', protect, requirePermission("organization", "update", { submodule: "departments" }), updateDepartment);

// Delete department (Admin only)
router.delete('/:id', protect, requirePermission("organization", "delete", { submodule: "departments" }), deleteDepartment);

module.exports = router;
