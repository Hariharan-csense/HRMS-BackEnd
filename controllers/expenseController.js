// src/controllers/expenseController.js
const knex = require('../db/db');
const path = require('path');
const fs = require('fs');
const { generateAutoNumber } = require('../utils/generateAutoNumber');
// const submitExpense = async (req, res) => {
//   const companyId = req.user.company_id;
//   if (!companyId) {
//     if (req.file) fs.unlinkSync(req.file.path);
//     return res.status(400).json({ message: 'You are not assigned to any company' });
//   }

//   const employeeId = req.user.id;

//   // Get employee name
//   const employee = await knex('employees')
//     .where({ id: employeeId, company_id: companyId })
//     .select('first_name', 'last_name')
//     .first();

//   if (!employee) {
//     if (req.file) fs.unlinkSync(req.file.path);
//     return res.status(404).json({ message: 'Employee not found' });
//   }

//   const employeeName = `${employee.first_name} ${employee.last_name || ''}`.trim();

//   const { category, amount, expense_date, description } = req.body;

//   if (!category?.trim() || !amount || !expense_date) {
//     if (req.file) fs.unlinkSync(req.file.path);
//     return res.status(400).json({ message: 'Category, Amount and Date are required' });
//   }

//   if (isNaN(amount) || parseFloat(amount) <= 0) {
//     if (req.file) fs.unlinkSync(req.file.path);
//     return res.status(400).json({ message: 'Amount must be a positive number' });
//   }

//   let receiptPath = null;
//   if (req.file) {
//     receiptPath = `/uploads/expenses/${req.file.filename}`;
//   }

//   try {
//     const expense_id = await generateAutoNumber(companyId ,'Expense');

//     const [newId] = await knex('expenses').insert({
//       company_id: companyId, // ← Company isolation
//       expense_id,
//       employee_id: employeeId,
//       employee_name: employeeName,
//       category: category.trim(),
//       amount: parseFloat(amount),
//       expense_date,
//       description: description?.trim() || null,
//       receipt_path: receiptPath,
//       status: 'Pending'
//     });

//     const newExpense = await knex('expenses').where({ id: newId }).first();

//     res.status(201).json({
//       success: true,
//       message: 'Expense claim submitted successfully!',
//       expense: {
//         ...newExpense,
//         receipt_url: receiptPath ? `${receiptPath}` : null
//       }
//     });

//   } catch (error) {
//     if (req.file) fs.unlinkSync(req.file.path);
//     console.error('Submit expense error:', error);
//     res.status(500).json({ message: 'Server error' });
//   }
// };

const submitExpense = async (req, res) => {
  try {
    const companyId = req.user.company_id;
    const employeeId = req.user.id;

    if (!companyId) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(400).json({ message: 'You are not assigned to any company' });
    }

    // Get employee
    const employee = await knex('employees')
      .where({ id: employeeId, company_id: companyId })
      .select('first_name', 'last_name')
      .first();

    if (!employee) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(404).json({ message: 'Employee not found' });
    }

    const { category, amount, expense_date, description } = req.body;

    if (!category?.trim() || !amount || !expense_date) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(400).json({ message: 'Category, Amount and Date are required' });
    }

    if (isNaN(amount) || parseFloat(amount) <= 0) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(400).json({ message: 'Amount must be a positive number' });
    }

    // ✅ Correct receipt path
    let receiptPath = null;
    if (req.file) {
      receiptPath = `/uploads/expenses/company_${companyId}/${req.file.filename}`;
    }

    const employeeName = `${employee.first_name} ${employee.last_name || ''}`.trim();
    const expense_id = await generateAutoNumber(companyId, 'Expense');

    const [newId] = await knex('expenses').insert({
      company_id: companyId,
      expense_id,
      employee_id: employeeId,
      employee_name: employeeName,
      category: category.trim(),
      amount: parseFloat(amount),
      expense_date,
      description: description?.trim() || null,
      receipt_path: receiptPath,
      status: 'Pending'
    });

    const newExpense = await knex('expenses').where({ id: newId }).first();

    res.status(201).json({
      success: true,
      message: 'Expense claim submitted successfully!',
      expense: {
        ...newExpense,
        receipt_url: receiptPath
      }
    });

  } catch (error) {
    if (req.file) fs.unlinkSync(req.file.path);
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

    if (req.user.role === 'admin' || req.user.role === 'hr' || req.user.role === 'finance') {
      // Admin/HR/Finance sees all in company with employee name
      expenses = await knex('expenses as e')
        .join('employees as emp', 'e.employee_id', 'emp.id')
        .select(
          'e.*',
          'emp.first_name',
          'emp.last_name',
          knex.raw("CONCAT(emp.first_name, ' ', emp.last_name) as employee_name")
        )
        .where('e.company_id', companyId)
        .orderBy('e.created_at', 'desc');
    } else {
      // Employee sees only own - no need for join since we know the name from token
      expenses = await knex('expenses')
        .where({ employee_id: req.user.id, company_id: companyId })
        .orderBy('created_at', 'desc');

      // Add employee_name from current user
      expenses = expenses.map(exp => ({
        ...exp,
        employee_name: req.user.name || "Unknown Employee"
      }));
    }

    // Add receipt_url
    const enriched = expenses.map(exp => ({
      ...exp,
      receipt_url: exp.receipt_path ? `${process.env.BASE_URL || ''}${exp.receipt_path}` : null
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

// Approve/Reject Expense (Admin/HR/Finance only - company scoped)
// const updateExpenseStatus = async (req, res) => {
//   const companyId = req.user.company_id;
//   if (!companyId) {
//     return res.status(400).json({ message: 'You are not assigned to any company' });
//   }

//   const { expense_id } = req.params;
//   const { status } = req.body; // "Approved" or "Rejected"

//   if (!['Approved', 'Rejected'].includes(status)) {
//     return res.status(400).json({ message: 'Status must be Approved or Rejected' });
//   }

//   try {
//     // Verify expense belongs to user's company
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

  const { expense_id } = req.params; // Make sure route is /expenses/:expense_id/status
  const { status } = req.body; // "Approved" or "Rejected"

  if (!['Approved', 'Rejected'].includes(status)) {
    return res.status(400).json({ message: 'Status must be Approved or Rejected' });
  }

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

    await knex('expenses').where({ expense_id }).update({
      status,
      approved_by: req.user.id,
      approved_at: knex.fn.now()
    });

    const updated = await knex('expenses').where({ expense_id }).first();

    res.json({
      success: true,
      message: `Expense ${status.toLowerCase()} successfully!`,
      expense: {
        ...updated,
        receipt_url: updated.receipt_path ? `${updated.receipt_path}` : null
      }
    });

  } catch (error) {
    console.error('Update expense status error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};


module.exports = {
  submitExpense,
  getExpenses,
  updateExpenseStatus
};