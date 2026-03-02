const express = require('express');
const {
  submitExpense,
  getExpenses,
  updateExpenseStatus,
  deleteExpense,
  scanReceiptOnly,
  exportExpenses
} = require('../controllers/expenseController');
const { protect } = require('../middleware/authMiddleware');
const { requirePermission, requireAnyPermission } = require("../middleware/rbacMiddleware");
const uploadReceipt = require('../middleware/expenseReceiptUpload');

const router = express.Router();

// Submit expense - any logged-in employee (token required)
// Optional receipt file upload using "receipt" field
router.post('/submit', protect, requirePermission("expenses", "create", { submodule: "claims" }), uploadReceipt, submitExpense);

// Scan receipt only - any logged-in employee (token required)
// Returns OCR data without creating expense
router.post('/scan-receipt', protect, requirePermission("expenses", "create", { submodule: "claims" }), uploadReceipt, scanReceiptOnly);

// Get expenses - token required
router.get('/', protect, requirePermission("expenses", "view"), getExpenses);

// Export expenses - token + Admin/Finance role required
router.post('/export', protect, requirePermission("expenses", "view", { submodule: "export" }), exportExpenses);

// Approve/Reject - token + Admin/Finance role required
router.put(
  '/:expense_id',
  protect,
  requireAnyPermission([
    { module: "expenses", submodule: "approvals", action: "approve" },
    { module: "expenses", submodule: "approvals", action: "reject" },
    { module: "expenses", submodule: "claims", action: "update" },
  ]),
  updateExpenseStatus
);

// Delete expense - owner/admin/finance (controller enforces access rules)
router.delete('/:expense_id', protect, requirePermission("expenses", "delete", { submodule: "claims" }), deleteExpense);

module.exports = router;
