// src/routes/departmentRoutes.js
const express = require('express');
const {
  addDepartment,
  getDepartments,
  updateDepartment,
  deleteDepartment
} = require('../controllers/departmentController');
const { protect, adminOnly } = require('../middleware/authMiddleware');

const router = express.Router();


router.get('/public', getDepartments);

router.get('/', protect, getDepartments);

// Add department (Admin only)
router.post('/add', protect, adminOnly, addDepartment);

// Update department (Admin only)
router.put('/:id', protect, adminOnly, updateDepartment);

// Delete department (Admin only)
router.delete('/:id', protect, adminOnly, deleteDepartment);

module.exports = router;