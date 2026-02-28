// src/controllers/expenseController.js
const knex = require('../db/db');
const path = require('path');
const fs = require('fs');
const { generateAutoNumber } = require('../utils/generateAutoNumber');
const scanReceipt = require('../utils/scanReceipt');
const moment = require('moment');
const { sendExpenseStatusNotification } = require('../utils/sendExpenseStatusMail');


// const submitExpense = async (req, res) => {
//   try {
//     const companyId = req.user.company_id;
//     const employeeId = req.user.id;

//     let { category, amount, expense_date, description } = req.body;

//     console.log('Uploaded file 👉', req.file); // DEBUG

//     let ocrData = {};

//     // ✅ OCR only if file exists
//     if (req.file) {
//       ocrData = await scanReceipt(req.file.path, req.file);
//     }

//     // 🔁 OCR fallback
//     amount = amount || ocrData.amount || null;
//     expense_date = expense_date || ocrData.expense_date || null;
//     description = description || ocrData.vendor || null;

//     // 🔎 REGEX FALLBACK (VERY IMPORTANT)
//     if (ocrData.fullText) {

//       // 💰 Amount
//       if (!amount) {
//         const amtMatch =
//           ocrData.fullText.match(/Amount To Pay\s*:?\s*Rs?\s*(\d+[.,]\d{2})/i) ||
//           ocrData.fullText.match(/Total\s*Rs?\s*(\d+[.,]\d{2})/i);

//         if (amtMatch) amount = amtMatch[1];
//       }

//       // 📅 Date
//       if (!expense_date) {
//         const dateMatch = ocrData.fullText.match(
//           /(\d{2}[\/\-]\d{2}[\/\-]\d{4})/
//         );

//         if (dateMatch) expense_date = dateMatch[1];
//       }
//     }

//     // ❌ FINAL VALIDATION
//     if (!category || !amount || !expense_date) {
//       return res.status(400).json({
//         message: 'Category, Amount and Date are required',
//         ocr_detected: {
//           amount: amount || null,
//           expense_date: expense_date || null,
//           vendor: ocrData.vendor || null
//         }
//       });
//     }

//     // 📁 Receipt path
//     const receiptPath = req.file
//       ? `/uploads/expenses/company_${companyId}/${req.file.filename}`
//       : null;

//     const expense_id = await generateAutoNumber(companyId, 'Expense');

//     const [id] = await knex('expenses').insert({
//       company_id: companyId,
//       expense_id,
//       employee_id: employeeId,
//       category,
//       amount: parseFloat(amount),
//       expense_date,
//       description,
//       receipt_path: receiptPath,
//       status: 'Pending'
//     });

//     const expense = await knex('expenses').where({ id }).first();

//     res.status(201).json({
//       success: true,
//       message: 'Expense submitted successfully',
//       expense
//     });

//   } catch (error) {
//     console.error('Submit expense error:', error);
//     res.status(500).json({ message: 'Server error' });
//   }
// };


const submitExpense = async (req, res) => {
  try {
    const companyId = req.user.company_id;
    const employeeId = req.user.id;
    const employeeName = req.user.name || '';

    let { category, amount, expense_date, description } = req.body;

    console.log('Uploaded file 👉', req.file); // DEBUG

    let ocrData = {};

    // ✅ OCR only if file exists
    if (req.file) {
      ocrData = await scanReceipt(req.file.path, req.file);
    }

    // 🔁 OCR fallback
    amount = amount || ocrData.amount || null;
    expense_date = expense_date || ocrData.expense_date || null;
    description = description || ocrData.vendor || null;

    // 🔎 REGEX FALLBACK with enhanced patterns
    if (ocrData.fullText) {
      // 💰 Amount extraction with enhanced regex patterns
      if (!amount) {
        const amtMatch =
          // 1. Strict final total patterns (highest priority)
          ocrData.fullText.match(/(?:GRAND\s*TOTAL|FINAL\s*TOTAL|TOTAL\s*DUE|TOTAL\s*PAYABLE|BILL\s*TOTAL|NET\s*TOTAL)[\s:]*\s*(?:Rs\.?|INR|\₹)?\s*([0-9]+(?:\.[0-9]{2})?)/i) ||
          // 2. Simple "TOTAL" patterns
          ocrData.fullText.match(/TOTAL[\s:]*\s*(?:Rs\.?|INR|\₹)?\s*([0-9]+(?:\.[0-9]{2})?)/i) ||
          // 3. Currency patterns (more flexible)
          ocrData.fullText.match(/(?:Rs\.?|INR|\₹)\s*([0-9]+(?:\.[0-9]{2})?)/i) ||
          // 4. Amount followed by currency (reverse pattern)
          ocrData.fullText.match(/([0-9]+(?:\.[0-9]{2})?)\s*(?:Rs\.?|INR|\₹)/i) ||
          // 5. Numbers with decimal points (likely amounts)
          ocrData.fullText.match(/([0-9]+\.[0-9]{2})/i) ||
          // 6. Amount at very bottom (last line)
          (() => {
            const lines = ocrData.fullText.split('\n').map(line => line.trim()).filter(line => line.length > 0);
            if (lines.length > 0) {
              const lastLine = lines[lines.length - 1];
              const match = lastLine.match(/^([0-9]+(?:\.[0-9]{2})?)\s*$/);
              if (match) {
                const amount = parseFloat(match[1].replace(',', ''));
                // Less strict filtering
                if (amount >= 1 && amount <= 10000 && 
                    !lastLine.toLowerCase().includes('phone') &&
                    !lastLine.toLowerCase().includes('bill no') &&
                    !lastLine.toLowerCase().includes('gst') &&
                    !lastLine.toLowerCase().includes('fssai') &&
                    !lastLine.toLowerCase().includes('qty') &&
                    !lastLine.toLowerCase().includes('rate') &&
                    !lastLine.toLowerCase().includes('mrp')) {
                  return match;
                }
              }
            }
            return null;
          })();
        
        if (amtMatch) {
          amount = amtMatch[1].replace(',', '');
        }
      }

      // 📅 Date
      if (!expense_date) {
        const dateMatch = ocrData.fullText.match(/(\d{2}[\/\-]\d{2}[\/\-]\d{4})/);
        if (dateMatch) expense_date = dateMatch[1];
      }
    }

    // 🏷️ AUTO CATEGORY
    if (!category && ocrData.vendor) {
      const vendorText = ocrData.vendor.toLowerCase();
      if (/(hotel|food|restaurant|canteen|super food)/i.test(vendorText)) {
        category = 'Food';
      } else if (/(uber|ola|taxi)/i.test(vendorText)) {
        category = 'Travel';
      } else {
        category = 'Miscellaneous';
      }
    }

    // ❌ FINAL VALIDATION - more flexible with OCR
    if (!category || !amount) {
      return res.status(400).json({
        message: 'Category and Amount are required',
        ocr_detected: {
          amount: amount || null,
          expense_date: expense_date || null,
          vendor: ocrData.vendor || null
        }
      });
    }

    // Use today's date if no date provided
    if (!expense_date) {
      expense_date = moment().format('YYYY-MM-DD');
    }

    // 🔧 Normalize date to YYYY-MM-DD
    const parsedDate = moment(expense_date, ['DD/MM/YYYY', 'DD-MM-YYYY', moment.ISO_8601], true);
    if (!parsedDate.isValid()) {
      return res.status(400).json({
        message: 'Invalid expense date format',
        ocr_detected: { expense_date }
      });
    }
    expense_date = parsedDate.format('YYYY-MM-DD');

    // 📁 Receipt path
    const receiptPath = req.file
      ? `/uploads/expenses/company_${companyId}/${req.file.filename}`
      : null;

    // Generate expense ID (EXP001 format)
    const lastExpense = await knex('expenses')
      .where({ company_id: companyId })
      .orderBy('id', 'desc')
      .first();

    let nextNumber = 1;
    if (lastExpense && lastExpense.expense_id) {
      const match = lastExpense.expense_id.match(/EXP(\d+)/);
      if (match) {
        nextNumber = parseInt(match[1]) + 1;
      }
    }

    const expense_id = `EXP${nextNumber.toString().padStart(3, '0')}`;

    // 📝 Insert expense
const [id] = await knex('expenses').insert({
  company_id: companyId,
  expense_id,
  employee_id: employeeId,
  employee_name: employeeName,  // ✅ add this
  category,
  amount: parseFloat(amount),
  expense_date,
  description,
  receipt_path: receiptPath,
  status: 'Pending'
});


    // ✅ Fetch inserted expense and add employee_name
    const expense = await knex('expenses').where({ id }).first();
    expense.employee_name = employeeName;

    res.status(201).json({
      success: true,
      message: 'Expense submitted successfully',
      expense
    });
  } catch (error) {
    console.error('Submit expense error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};


const getExpenses = async (req, res) => {
  const companyId = req.user.company_id;
  if (!companyId) {
    return res.status(400).json({ message: 'You are not assigned to any company' });
  }

  try {
    let expenses;

    // 🔐 ADMIN + FINANCE → All expenses
    if (req.user.role === 'admin' || req.user.role === 'finance') {
      expenses = await knex('expenses as e')
        .join('employees as emp', 'e.employee_id', 'emp.id')
        .select(
          'e.id',
          'e.expense_id',
          'e.employee_id',
          'e.company_id',
          'e.category',
          'e.amount',
          knex.raw("DATE_FORMAT(e.expense_date, '%Y-%m-%d') as expense_date"),
          'e.description',
          'e.receipt_path',
          'e.status',
          'e.approved_by',
          'e.approved_at',
          'e.created_at',
          'e.updated_at',
          knex.raw("CONCAT(emp.first_name, ' ', emp.last_name) as employee_name")
        )
        .where('e.company_id', companyId)
        .orderBy('e.created_at', 'desc');
    } 
    // 🔒 ALL OTHERS → Only self
    else {
      expenses = await knex('expenses as e')
        .select(
          'e.id',
          'e.expense_id',
          'e.employee_id',
          'e.company_id',
          'e.category',
          'e.amount',
          knex.raw("DATE_FORMAT(e.expense_date, '%Y-%m-%d') as expense_date"),
          'e.description',
          'e.receipt_path',
          'e.status',
          'e.approved_by',
          'e.approved_at',
          'e.created_at',
          'e.updated_at'
        )
        .where({ 
          'e.employee_id': req.user.id, 
          'e.company_id': companyId 
        })
        .orderBy('e.created_at', 'desc');

      expenses = expenses.map(exp => ({
        ...exp,
        employee_name: req.user.name || 'Unknown Employee'
      }));
    }

    // 🔥 FINAL SAFETY FORMAT
    const enriched = expenses.map(exp => ({
      ...exp,
      expense_date: exp.expense_date
        ? String(exp.expense_date).substring(0, 10)
        : null,
      receipt_url: exp.receipt_path
        ? `${process.env.BASE_URL || ''}${exp.receipt_path}`
        : null
    }));

    res.json({
      success: true,
      count: enriched.length,
      expenses: enriched
    });
  } catch (error) {
    console.error('Get expenses error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};


// const updateExpenseStatus = async (req, res) => {
//   const companyId = req.user.company_id;
//   if (!companyId) {
//     return res.status(400).json({ message: 'You are not assigned to any company' });
//   }

//   const { expense_id } = req.params; // Make sure route is /expenses/:expense_id/status
//   const { status } = req.body; // "Approved" or "Rejected"

//   if (!['Approved', 'Rejected'].includes(status)) {
//     return res.status(400).json({ message: 'Status must be Approved or Rejected' });
//   }

//   if (!expense_id) {
//     return res.status(400).json({ message: 'Expense ID is required' });
//   }

//   try {
//     const expense = await knex('expenses')
//       .where({ expense_id, company_id: companyId })
//       .first();

//     if (!expense) {
//       return res.status(404).json({ message: 'Expense not found or access denied' });
//     }

//     await knex('expenses').where({ expense_id }).update({
//       status,
//       approved_by: req.user.id,
//       approved_at: knex.fn.now()
//     });

//     const updated = await knex('expenses').where({ expense_id }).first();

//     res.json({
//       success: true,
//       message: `Expense ${status.toLowerCase()} successfully!`,
//       expense: {
//         ...updated,
//         receipt_url: updated.receipt_path ? `${updated.receipt_path}` : null
//       }
//     });

//   } catch (error) {
//     console.error('Update expense status error:', error);
//     res.status(500).json({ message: 'Server error' });
//   }
// };


const updateExpenseStatus = async (req, res) => {
  const companyId = req.user.company_id;
  if (!companyId) {
    return res.status(400).json({ message: 'You are not assigned to any company' });
  }

  const { expense_id } = req.params;
  const { status } = req.body;

  if (!['Approved', 'Rejected'].includes(status)) {
    return res.status(400).json({ message: 'Status must be Approved or Rejected' });
  }

  if (!expense_id) {
    return res.status(400).json({ message: 'Expense ID is required' });
  }

  try {
    console.log('🔍 Updating expense:', expense_id, 'Status:', status);

    const expense = await knex('expenses')
      .where({ expense_id, company_id: companyId })
      .first();

    if (!expense) {
      return res.status(404).json({ message: 'Expense not found or access denied' });
    }

    await knex('expenses')
      .where({ expense_id })
      .update({
        status,
        approved_by: req.user.id,
        approved_at: knex.fn.now()
      });

    const updated = await knex('expenses')
      .where({ expense_id })
      .first();

    const employee = await knex('employees')
      .where({ id: updated.employee_id })
      .first();

    console.log('👤 Employee record:', employee);
    console.log('📨 Email To:', employee?.email);

    // ✅ FIXED: use employee.email
    if (employee && employee.email) {
      console.log('📨 Trying to send expense status email...');

      try {
        await sendExpenseStatusNotification(
          updated,
          {
            employee_email: employee.email,   // ✅ FIX
            employee_name: `${employee.first_name} ${employee.last_name}`
          },
          status.toLowerCase()
        );

        console.log('📧 Mail function completed');
      } catch (mailError) {
        console.error('⚠️ Mail sending failed:', mailError);
      }

    } else {
      console.warn('⚠️ No employee email found. Skipping mail.');
    }

    res.json({
      success: true,
      message: `Expense ${status.toLowerCase()} successfully!`,
      expense: {
        ...updated,
        receipt_url: updated.receipt_path ? `${updated.receipt_path}` : null
      }
    });

  } catch (error) {
    console.error('🔥 Update expense status error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

const deleteExpense = async (req, res) => {
  const companyId = req.user.company_id;
  if (!companyId) {
    return res.status(400).json({ message: 'You are not assigned to any company' });
  }

  const { expense_id } = req.params;
  if (!expense_id) {
    return res.status(400).json({ message: 'Expense ID is required' });
  }

  try {
    const expense = await knex('expenses')
      .where({ expense_id, company_id: companyId })
      .first();

    if (!expense) {
      return res.status(404).json({ message: 'Expense not found or access denied' });
    }

    const isAdminOrFinance = req.user.role === 'admin' || req.user.role === 'finance';
    const isOwner = Number(expense.employee_id) === Number(req.user.id);

    if (!isAdminOrFinance && !isOwner) {
      return res.status(403).json({ message: 'You are not allowed to delete this expense' });
    }

    if (String(expense.status || '').toLowerCase() !== 'pending' && !isAdminOrFinance) {
      return res.status(400).json({ message: 'Only pending expenses can be deleted' });
    }

    await knex('expenses')
      .where({ expense_id, company_id: companyId })
      .del();

    res.json({
      success: true,
      message: 'Expense deleted successfully'
    });
  } catch (error) {
    console.error('Delete expense error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};


const scanReceiptOnly = async (req, res) => {
  try {
    console.log('Scanning receipt file 👉', req.file);

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    // ✅ OCR the uploaded file
    const ocrData = await scanReceipt(req.file.path, req.file);

    // 🔎 REGEX FALLBACK for additional extraction
    let extractedAmount = ocrData.amount;
    let extractedDate = ocrData.expense_date;
    let extractedVendor = ocrData.vendor;

    if (ocrData.fullText) {
      // 💰 Amount extraction with enhanced regex patterns
      if (!extractedAmount) {
        const amtMatch =
          // 1. Strict final total patterns (highest priority)
          ocrData.fullText.match(/(?:GRAND\s*TOTAL|FINAL\s*TOTAL|TOTAL\s*DUE|TOTAL\s*PAYABLE|BILL\s*TOTAL|NET\s*TOTAL)[\s:]*\s*(?:Rs\.?|INR|\₹)?\s*([0-9]+(?:\.[0-9]{2})?)/i) ||
          // 2. Simple "TOTAL" patterns
          ocrData.fullText.match(/TOTAL[\s:]*\s*(?:Rs\.?|INR|\₹)?\s*([0-9]+(?:\.[0-9]{2})?)/i) ||
          // 3. Currency patterns (more flexible)
          ocrData.fullText.match(/(?:Rs\.?|INR|\₹)\s*([0-9]+(?:\.[0-9]{2})?)/i) ||
          // 4. Amount followed by currency (reverse pattern)
          ocrData.fullText.match(/([0-9]+(?:\.[0-9]{2})?)\s*(?:Rs\.?|INR|\₹)/i) ||
          // 5. Numbers with decimal points (likely amounts)
          ocrData.fullText.match(/([0-9]+\.[0-9]{2})/i) ||
          // 6. Amount at very bottom (last line)
          (() => {
            const lines = ocrData.fullText.split('\n').map(line => line.trim()).filter(line => line.length > 0);
            if (lines.length > 0) {
              const lastLine = lines[lines.length - 1];
              const match = lastLine.match(/^([0-9]+(?:\.[0-9]{2})?)\s*$/);
              if (match) {
                const amount = parseFloat(match[1].replace(',', ''));
                // Less strict filtering
                if (amount >= 1 && amount <= 10000 && 
                    !lastLine.toLowerCase().includes('phone') &&
                    !lastLine.toLowerCase().includes('bill no') &&
                    !lastLine.toLowerCase().includes('gst') &&
                    !lastLine.toLowerCase().includes('fssai') &&
                    !lastLine.toLowerCase().includes('qty') &&
                    !lastLine.toLowerCase().includes('rate') &&
                    !lastLine.toLowerCase().includes('mrp')) {
                  return match;
                }
              }
            }
            return null;
          })();
        
        if (amtMatch) {
          extractedAmount = amtMatch[1].replace(',', '');
        }
      }

      // 📅 Date extraction with regex
      if (!extractedDate) {
        const dateMatch = ocrData.fullText.match(/(\d{2}[\/\-]\d{2}[\/\-]\d{4})/);
        if (dateMatch) {
          extractedDate = dateMatch[1];
        }
      }

      // 🏪 Vendor extraction (simple approach - look for capitalized text at beginning)
      if (!extractedVendor) {
        const lines = ocrData.fullText.split('\n').filter(line => line.trim().length > 0);
        if (lines.length > 0) {
          const firstLine = lines[0].trim();
          if (firstLine.length > 3 && /^[A-Z]/.test(firstLine)) {
            extractedVendor = firstLine;
          }
        }
      }
    }

    // 🏷️ AUTO CATEGORY based on vendor
    let suggestedCategory = null;
    if (extractedVendor) {
      const vendorText = extractedVendor.toLowerCase();
      if (/(hotel|food|restaurant|canteen|super food|cafe|dhaba)/i.test(vendorText)) {
        suggestedCategory = 'Food';
      } else if (/(uber|ola|taxi|auto|cab)/i.test(vendorText)) {
        suggestedCategory = 'Travel';
      } else if (/(fuel|petrol|diesel|gas)/i.test(vendorText)) {
        suggestedCategory = 'Travel';
      } else if (/(medical|hospital|clinic|pharmacy)/i.test(vendorText)) {
        suggestedCategory = 'Medical';
      } else {
        suggestedCategory = 'Miscellaneous';
      }
    }

    // 🧹 Clean up uploaded file after scanning
    try {
      fs.unlinkSync(req.file.path);
    } catch (cleanupError) {
      console.warn('Failed to cleanup temp file:', cleanupError);
    }

    res.status(200).json({
      success: true,
      message: 'Receipt scanned successfully',
      data: {
        amount: extractedAmount,
        date: extractedDate,
        vendor: extractedVendor,
        category: suggestedCategory,
        fullText: ocrData.fullText
      }
    });

  } catch (error) {
    console.error('Scan receipt error:', error);
    
    // 🧹 Clean up uploaded file on error
    if (req.file && req.file.path) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (cleanupError) {
        console.warn('Failed to cleanup temp file on error:', cleanupError);
      }
    }

    res.status(500).json({
      success: false,
      message: 'Failed to scan receipt',
      error: error.message
    });
  }
};

const exportExpenses = async (req, res) => {
  const companyId = req.user.company_id;
  if (!companyId) {
    return res.status(400).json({ message: 'You are not assigned to any company' });
  }

  const { employeeIds, format, statusFilter, dateFilter } = req.body;

  try {
    let query = knex('expenses as e')
      .join('employees as emp', 'e.employee_id', 'emp.id')
      .select(
        'e.expense_id',
        'e.employee_id',
        'e.category',
        'e.amount',
        knex.raw("DATE_FORMAT(e.expense_date, '%Y-%m-%d') as expense_date"),
        'e.description',
        'e.status',
        'e.approved_by',
        'e.approved_at',
        'e.created_at',
        knex.raw("CONCAT(emp.first_name, ' ', emp.last_name) as employee_name")
      )
      .where('e.company_id', companyId);

    // Apply employee filter if specific employees are selected
    if (employeeIds && employeeIds.length > 0 && !employeeIds.includes('all')) {
      query = query.whereIn('e.employee_id', employeeIds);
    }

    // Apply status filter
    if (statusFilter && statusFilter !== 'all') {
      query = query.where('e.status', statusFilter);
    }

    // Apply date filter
    if (dateFilter) {
      const { startDate, endDate } = dateFilter;
      if (startDate) {
        query = query.where('e.expense_date', '>=', startDate);
      }
      if (endDate) {
        query = query.where('e.expense_date', '<=', endDate);
      }
    }

    const expenses = await query.orderBy('e.created_at', 'desc');

    // Format data for export
    const exportData = expenses.map(exp => ({
      'Expense ID': exp.expense_id,
      'Employee Name': exp.employee_name,
      'Employee ID': exp.employee_id,
      'Category': exp.category,
      'Amount': parseFloat(exp.amount),
      'Date': exp.expense_date,
      'Description': exp.description || '',
      'Status': exp.status,
      'Approved By': exp.approved_by || '',
      'Approved Date': exp.approved_at ? new Date(exp.approved_at).toLocaleDateString() : '',
      'Submitted Date': exp.created_at ? new Date(exp.created_at).toLocaleDateString() : ''
    }));

    if (format === 'csv') {
      // Generate CSV
      const csvHeader = Object.keys(exportData[0] || {}).join(',');
      const csvRows = exportData.map(row => 
        Object.values(row).map(value => 
          typeof value === 'string' && value.includes(',') 
            ? `"${value.replace(/"/g, '""')}"` 
            : value
        ).join(',')
      );
      
      const csvContent = [csvHeader, ...csvRows].join('\n');
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=expenses_${moment().format('YYYY-MM-DD')}.csv`);
      res.send(csvContent);
    } else {
      // Default to JSON format
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename=expenses_${moment().format('YYYY-MM-DD')}.json`);
      res.json({
        success: true,
        exportDate: moment().format('YYYY-MM-DD HH:mm:ss'),
        totalRecords: exportData.length,
        expenses: exportData
      });
    }

  } catch (error) {
    console.error('Export expenses error:', error);
    res.status(500).json({ message: 'Server error during export' });
  }
};

module.exports = {
  submitExpense,
  getExpenses,
  updateExpenseStatus,
  deleteExpense,
  scanReceiptOnly,
  exportExpenses
};
