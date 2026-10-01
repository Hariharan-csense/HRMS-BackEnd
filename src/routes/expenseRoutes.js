const { requestDeletion } = require("../middleware/deletionApproval");
const express = require('express');
const {
  submitExpense,
  submitExpensesBulk,
  getExpenses,
  updateExpenseStatus,
  deleteExpense,
  scanReceiptOnly,
  exportExpenses,
  getAssignedClientsForClaims,
  getExpenseDraft,
  saveExpenseDraft,
  deleteExpenseDraft
} = require('../controllers/expenseController');
const { protect } = require('../middleware/authMiddleware');
const { requirePermission, requireAnyPermission } = require("../middleware/rbacMiddleware");
const uploadReceipt = require('../middleware/expenseReceiptUpload');
const uploadReceipts = require('../middleware/expenseReceiptsUpload');

const router = express.Router();

// Submit expense - any logged-in employee (token required)
// Optional receipt file upload using "receipt" field
router.post('/submit', protect, requirePermission("expenses", "create", { submodule: "claims" }), uploadReceipt, submitExpense);

// Submit multiple expenses in a single request (multipart: `expenses` JSON + files `receipt_0`, `receipt_1`, ...)
router.post('/submit-bulk', protect, requirePermission("expenses", "create", { submodule: "claims" }), uploadReceipts, submitExpensesBulk);

// Scan receipt only - any logged-in employee (token required)
// Returns OCR data without creating expense
router.post('/scan-receipt', protect, requirePermission("expenses", "create", { submodule: "claims" }), uploadReceipt, scanReceiptOnly);

// Get assigned clients for expense claims (employees get only their assigned clients)
router.get('/assigned-clients', protect, requirePermission("expenses", "create", { submodule: "claims" }), getAssignedClientsForClaims);

// Drafts for expense claims
router.get('/draft', protect, requirePermission("expenses", "create", { submodule: "claims" }), getExpenseDraft);
router.post('/draft', protect, requirePermission("expenses", "create", { submodule: "claims" }), uploadReceipts, saveExpenseDraft);
router.delete('/draft', protect, requirePermission("expenses", "create", { submodule: "claims" }), deleteExpenseDraft);
router.delete('/draft/:draft_id', protect, requirePermission("expenses", "create", { submodule: "claims" }), deleteExpenseDraft);

// Get expenses - token required
router.get('/', protect, requirePermission("expenses", "view"), getExpenses);

// Export expenses - token + Admin/Finance role required
router.post('/export', protect, requirePermission("expenses", "view", { submodule: "export" }), exportExpenses);

// Approve/Reject - token + Admin/Finance role required
router.put(
  '/:expense_id',
  protect,
  (req, res, next) => {
    if (String(req.user?.type || '').toLowerCase() === 'employee') return next();
    return requireAnyPermission([
      { module: "expenses", submodule: "approvals", action: "approve" },
      { module: "expenses", submodule: "approvals", action: "reject" },
      { module: "expenses", submodule: "claims", action: "update" },
    ])(req, res, next);
  },
  uploadReceipt,
  updateExpenseStatus
);

// Delete expense - owner/admin/finance (controller enforces access rules)
router.delete(
  '/:expense_id',
  protect,
  requirePermission("expenses", "delete", { submodule: "claims" }),
  (req, res, next) => {
    // CEO approval is required only when the Admin account initiates deletion.
    // Employees and other authorized roles delete directly through the
    // expense controller, which still checks ownership and pending status.
    if (String(req.user?.role || '').toLowerCase() === 'admin') {
      return requestDeletion("expense", { param: "expense_id" })(req, res, next);
    }
    return deleteExpense(req, res, next);
  },
);

module.exports = router;
