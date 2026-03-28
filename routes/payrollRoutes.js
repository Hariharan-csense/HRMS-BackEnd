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
const { protect } = require('../middleware/authMiddleware');
const { requirePermission } = require("../middleware/rbacMiddleware");

const router = express.Router();

// Salary Structure routes
router.route('/salary-structure')
  .get(protect, requirePermission("payroll", "view", { submodule: "salary_structure" }), getSalaryStructures)
  .post(protect, requirePermission("payroll", "create", { submodule: "salary_structure" }), saveSalaryStructure);

// Process payroll (create/update monthly payroll)
router.post('/process', protect, requirePermission("payroll", "create", { submodule: "processing" }), processPayroll);

// Update payroll status
router.put('/processing/:id/status', protect, requirePermission("payroll", "update", { submodule: "processing" }), updatePayrollStatus);

// Get payroll records
router.get('/', protect, requirePermission("payroll", "view"), getPayrollRecords);

// Alias for frontend: list payslips/payroll records
router.get('/payslips', protect, requirePermission("payroll", "view", { submodule: "payslips" }), getPayrollRecords);

// Get employee payslips (for employees to see their own payslips)
router.get('/employee/payslips', protect, requirePermission("payroll", "view", { submodule: "payslips" }), getEmployeePayslips);

// Generate payslip preview
router.get('/:employee_id/:month', protect, requirePermission("payroll", "view", { submodule: "payslips" }), payslipPreview);

// Update salary structure
router.put('/structure/:id', protect, requirePermission("payroll", "update", { submodule: "salary_structure" }), updateSalaryStructure);

// Delete salary structure
router.delete('/structure/:id', protect, requirePermission("payroll", "delete", { submodule: "salary_structure" }), deleteSalaryStructure);


module.exports = router;
