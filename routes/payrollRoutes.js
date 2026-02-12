// src/routes/payrollRoutes.js
const express = require('express');
const {
  saveSalaryStructure,
  getSalaryStructures,
  processPayroll,
  updatePayrollStatus,
  getPayrollRecords,
  payslipPreview,
  getEmployeePayslips,
  updateSalaryStructure,
  deleteSalaryStructure,
} = require('../controllers/payrollController');
const { protect, adminOnly } = require('../middleware/authMiddleware');

const router = express.Router();

// Salary Structure routes
router.route('/salary-structure')
  .get(protect, getSalaryStructures)  // Get all salary structures
  .post(protect, adminOnly, saveSalaryStructure);  // Save salary structure (create/update)

// Process payroll (create/update monthly payroll)
router.post('/process', protect, adminOnly, processPayroll);

// Update payroll status
router.put('/processing/:id/status', protect, adminOnly, updatePayrollStatus);

// Get payroll records
router.get('/', protect, getPayrollRecords);

// Get employee payslips (for employees to see their own payslips)
router.get('/employee/payslips', protect, getEmployeePayslips);

// Generate payslip preview
router.get('/:employee_id/:month',protect,payslipPreview);

// Update salary structure
router.put('/structure/:id', protect, adminOnly, updateSalaryStructure);

// Delete salary structure
router.delete('/structure/:id', protect, adminOnly, deleteSalaryStructure);


module.exports = router;