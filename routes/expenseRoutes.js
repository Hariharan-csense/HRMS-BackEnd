const express = require('express');
const {
  submitExpense,
  getExpenses,
  updateExpenseStatus
} = require('../controllers/expenseController');
const { protect } = require('../middleware/authMiddleware');
const { adminOrFinance } = require('../middleware/roleMiddleware');
const uploadReceipt = require('../middleware/expenseReceiptUpload');

const router = express.Router();

// Submit expense - any logged-in employee (token required)
// Optional receipt file upload using "receipt" field
router.post('/submit', protect, uploadReceipt, submitExpense);

// Get expenses - token required
router.get('/', protect, getExpenses);

// Approve/Reject - token + Admin/Finance role required
router.put('/:expense_id', protect, adminOrFinance, updateExpenseStatus);

module.exports = router;
