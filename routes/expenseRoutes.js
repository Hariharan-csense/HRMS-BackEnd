const express = require('express');
const {
  submitExpense,
  getExpenses,
  updateExpenseStatus,
  scanReceiptOnly,
  exportExpenses
} = require('../controllers/expenseController');
const { protect, adminOnly } = require('../middleware/authMiddleware');
const { adminOrFinance } = require('../middleware/roleMiddleware');
const uploadReceipt = require('../middleware/expenseReceiptUpload');

const router = express.Router();

// Submit expense - any logged-in employee (token required)
// Optional receipt file upload using "receipt" field
router.post('/submit', protect, uploadReceipt, submitExpense);

// Scan receipt only - any logged-in employee (token required)
// Returns OCR data without creating expense
router.post('/scan-receipt', protect, uploadReceipt, scanReceiptOnly);

// Get expenses - token required
router.get('/', protect, getExpenses);

// Export expenses - token + Admin/Finance role required
router.post('/export', protect, adminOrFinance, exportExpenses);

// Approve/Reject - token + Admin/Finance role required
router.put('/:expense_id', protect, adminOrFinance, updateExpenseStatus);

module.exports = router;
