// src/controllers/expenseController.js
const knex = require('../db/db');
const path = require('path');
const fs = require('fs');
const { generateAutoNumber } = require('../utils/generateAutoNumber');
const scanReceipt = require('../utils/scanReceipt');
const moment = require('moment');
const { sendExpenseStatusNotification } = require('../utils/sendExpenseStatusMail');
const { hasAnyRole } = require('../middleware/authMiddleware');
const {
  applyEmployeeAssignmentFilter,
  getAssignedClientCountForEmployee,
  isClientAssignedToEmployee,
} = require('../utils/clientAssignments');

const isPrivilegedExpenseRole = (user) =>
  hasAnyRole(user, ['admin', 'finance', 'ceo', 'superadmin']);

const resolveExpenseEmployeeProfile = async (req, companyId) => {
  const mappedId = Number(req.user?.employee_id);
  if (Number.isFinite(mappedId) && mappedId > 0) {
    const byMappedId = await knex('employees')
      .where({ id: mappedId, company_id: companyId })
      .first();
    if (byMappedId) return byMappedId;
  }

  if (String(req.user?.type || '').toLowerCase() === 'employee') {
    const byId = await knex('employees')
      .where({ id: Number(req.user?.id), company_id: companyId })
      .first();
    if (byId) return byId;
  }

  if (req.user?.email) {
    const byEmail = await knex('employees')
      .where({ company_id: companyId })
      .whereRaw('LOWER(email) = ?', [String(req.user.email).toLowerCase().trim()])
      .first();
    if (byEmail) return byEmail;
  }

  return null;
};

const resolveExpenseEmployeeId = async (req, companyId) => {
  const profile = await resolveExpenseEmployeeProfile(req, companyId);
  return profile ? Number(profile.id) : null;
};

const normalizeExpenseCategory = (raw) => {
  if (!raw) return null;
  const value = String(raw).trim().toLowerCase();
  const mapped = {
    travel: 'Travel',
    food: 'Food',
    accommodation: 'Accommodation',
    accomodation: 'Accommodation',
    others: 'Others',
    other: 'Others'
  };
  return mapped[value] || String(raw).trim();
};

const csvEscape = (value) => {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
};

const formatExpenseExportDate = (value) => {
  const parsed = moment(value, ['YYYY-MM-DD', moment.ISO_8601], true);
  if (!parsed.isValid()) return value || '';
  return parsed.format('DD-MMM-YY');
};

const excelText = (value) => {
  const text = String(value || '').replace(/"/g, '""');
  return text ? `="${text}"` : '';
};

const formatExpenseExportAmount = (value) => {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount) || amount === 0) return '₹0';
  return `₹${amount.toLocaleString('en-IN', {
    maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
  })}`;
};

const inferTravelModel = (description = '') => {
  const text = String(description || '').toLowerCase();
  if (!text) return '';
  if (text.includes('train') && text.includes('bus')) return 'Train & Reg Bus';
  if (text.includes('ac sleeper')) return 'AC Sleeper Bus';
  if (text.includes('bus')) return 'Bus - Regular';
  if (text.includes('train')) return 'Train';
  if (text.includes('auto')) return 'Auto';
  if (text.includes('cab') || text.includes('taxi')) return 'Cab';
  if (text.includes('car')) return 'Car';
  return '';
};

const buildExpenseModelExportRows = (expenses) => {
  const grouped = new Map();

  expenses.forEach((expense) => {
    const key = [
      expense.employee_id,
      expense.expense_date,
      expense.client_name || '',
      expense.created_at ? moment(expense.created_at).format('YYYY-MM-DD HH:mm:ss') : '',
    ].join('|');

    if (!grouped.has(key)) {
      const employeeName = String(expense.employee_name || '').trim();
      grouped.set(key, {
        month: excelText(
          moment(expense.expense_date, 'YYYY-MM-DD', true).isValid()
            ? moment(expense.expense_date).format('MMM-YY')
            : '',
        ),
        date: excelText(formatExpenseExportDate(expense.expense_date)),
        consultant: employeeName.split(/\s+/)[0] || employeeName,
        client: expense.client_name || '',
        from: '',
        to: '',
        modelOfTravel: '',
        travel: 0,
        stay: 0,
        food: 0,
        other: 0,
        total: 0,
        remarks: [],
      });
    }

    const row = grouped.get(key);
    const category = normalizeExpenseCategory(expense.category);
    const amount = Number(expense.amount || 0);
    const description = String(expense.description || '').trim();

    if (category === 'Travel') {
      row.travel += amount;
      row.modelOfTravel = row.modelOfTravel || inferTravelModel(description);
    } else if (category === 'Accommodation') {
      row.stay += amount;
    } else if (category === 'Food') {
      row.food += amount;
    } else {
      row.other += amount;
      if (description) row.remarks.push(`*Others : ${description}`);
    }

    if (category !== 'Others' && description && !row.remarks.includes(description)) {
      row.remarks.push(description);
    }

    row.total += amount;
  });

  return Array.from(grouped.values()).map((row, index) => ({
    'S.No': index + 1,
    Month: row.month,
    Date: row.date,
    Consultant: row.consultant,
    Client: row.client,
    From: row.from,
    To: row.to,
    'Model of Travel': row.modelOfTravel,
    Travel: formatExpenseExportAmount(row.travel),
    Stay: formatExpenseExportAmount(row.stay),
    Food: formatExpenseExportAmount(row.food),
    Other: formatExpenseExportAmount(row.other),
    Total: formatExpenseExportAmount(row.total),
    Remarks: row.remarks.join(' | '),
  }));
};

const parseExpenseDateToISO = (raw) => {
  if (!raw) return null;
  const parsed = moment(String(raw).trim(), ['YYYY-MM-DD', 'DD/MM/YYYY', 'DD-MM-YYYY', moment.ISO_8601], true);
  if (!parsed.isValid()) return null;
  return parsed.format('YYYY-MM-DD');
};

const assertClientIsAllowed = async ({ companyId, employeeId, userType, clientId }) => {
  if (!clientId) return null;

  const client = await knex('clients')
    .select('id', 'client_name', 'assigned_to', 'company_id')
    .where({ id: clientId, company_id: companyId })
    .first();

  if (!client) return null;

  if (String(userType || '').toLowerCase() === 'employee') {
    const assignedClientCount = await getAssignedClientCountForEmployee({ companyId, employeeId });

    // Employees with assigned clients are restricted to those clients.
    // Employees with no assignment can submit against any client in their company.
    const isAssigned = await isClientAssignedToEmployee({
      clientId,
      companyId,
      employeeId,
    });

    if (assignedClientCount > 0 && !isAssigned) {
      return null;
    }
  }

  return client;
};

let ensureExpenseDraftsTablePromise = null;
const ensureExpenseDraftsTable = async () => {
  if (!ensureExpenseDraftsTablePromise) {
    ensureExpenseDraftsTablePromise = (async () => {
      const exists = await knex.schema.hasTable('expense_drafts');
      if (!exists) {
        await knex.schema.createTable('expense_drafts', (table) => {
          table.increments('id').primary();
          table.integer('company_id').unsigned().notNullable().index();
          table.integer('employee_id').unsigned().notNullable().index();
          table.integer('client_id').unsigned().nullable().index();
          table.text('draft_data', 'longtext').notNullable(); // JSON string
          table.timestamps(true, true);
        });
      }

      // Older deployments created a unique constraint on company_id + employee_id,
      // which forces a single draft per employee. Drop it so multiple drafts can coexist.
      try {
        await knex.raw('ALTER TABLE expense_drafts DROP INDEX expense_drafts_company_id_employee_id_unique');
      } catch (error) {
        const message = String(error?.message || '').toLowerCase();
        if (
          !message.includes('check that column/key exists') &&
          !message.includes('can\'t drop') &&
          !message.includes('does not exist') &&
          !message.includes('no such index')
        ) {
          throw error;
        }
      }

      return true;
    })().catch((err) => {
      ensureExpenseDraftsTablePromise = null;
      throw err;
    });
  }

  return ensureExpenseDraftsTablePromise;
};

let ensureExpensesClientIdColumnPromise = null;
const ensureExpensesClientIdColumn = async () => {
  if (!ensureExpensesClientIdColumnPromise) {
    ensureExpensesClientIdColumnPromise = (async () => {
      const hasColumn = await knex.schema.hasColumn('expenses', 'client_id');
      if (hasColumn) return true;

      try {
        await knex.schema.alterTable('expenses', (table) => {
          table.integer('client_id').unsigned().nullable().index();
        });
        return true;
      } catch {
        return false;
      }
    })().catch((err) => {
      ensureExpensesClientIdColumnPromise = null;
      throw err;
    });
  }

  return ensureExpensesClientIdColumnPromise;
};

const hasExpensesClientIdColumn = async () => {
  try {
    return await knex.schema.hasColumn('expenses', 'client_id');
  } catch {
    return false;
  }
};


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
    const employeeProfile = await resolveExpenseEmployeeProfile(req, companyId);
    if (!employeeProfile) {
      return res.status(400).json({
        message:
          'No employee profile is linked to this account. Link the admin email to an employee record to submit expense claims.',
      });
    }
    const employeeId = Number(employeeProfile.id);
    const employeeName =
      `${employeeProfile.first_name || ''} ${employeeProfile.last_name || ''}`.trim() ||
      req.user.name ||
      '';
    const userType = req.user.type;

    let { category, amount, expense_date, description, client_id } = req.body;

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

    // Optional: validate assigned client (if provided)
    const clientId = client_id ? Number(client_id) : null;
    if (clientId) {
      const client = await assertClientIsAllowed({ companyId, employeeId, userType, clientId });
      // if (!client) {
      //   return res.status(400).json({ message: 'Invalid assigned client' });
      // }
    }

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

    const canStoreClientId = await ensureExpensesClientIdColumn();

    // 📝 Insert expense
    const [id] = await knex('expenses').insert({
      company_id: companyId,
      expense_id,
      employee_id: employeeId,
      employee_name: employeeName,  // ✅ add this
      ...(canStoreClientId ? { client_id: clientId || null } : {}),
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

const submitExpensesBulk = async (req, res) => {
  const companyId = req.user.company_id;

  if (!companyId) {
    return res.status(400).json({ message: 'You are not assigned to any company' });
  }

  try {
    const employeeProfile = await resolveExpenseEmployeeProfile(req, companyId);
    if (!employeeProfile) {
      return res.status(400).json({
        message:
          'No employee profile is linked to this account. Link the admin email to an employee record to submit expense claims.',
      });
    }
    const employeeId = Number(employeeProfile.id);
    const employeeName =
      `${employeeProfile.first_name || ''} ${employeeProfile.last_name || ''}`.trim() ||
      req.user.name ||
      '';
    const userType = req.user.type;
    const clientId = req.body.client_id ? Number(req.body.client_id) : null;
    // if (!clientId || Number.isNaN(clientId)) {
    //   return res.status(400).json({ message: 'Assigned client is required' });
    // }

    let client = null;
    if (clientId) {
      client = await assertClientIsAllowed({ companyId, employeeId, userType, clientId });
      if (!client) {
        return res.status(400).json({ message: 'Invalid assigned client' });
      }
    }

    const canStoreClientId = await ensureExpensesClientIdColumn();

    let items = req.body.expenses;
    if (typeof items === 'string') {
      items = JSON.parse(items);
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'At least one expense is required' });
    }

    if (items.length > 25) {
      return res.status(400).json({ message: 'Too many expenses in one request (max 25)' });
    }

    const files = Array.isArray(req.files) ? req.files : [];
    const filesByField = {};
    for (const file of files) {
      if (file && file.fieldname) {
        filesByField[file.fieldname] = file;
      }
    }

    const inserted = await knex.transaction(async (trx) => {
      const lastExpense = await trx('expenses')
        .where({ company_id: companyId })
        .orderBy('id', 'desc')
        .first();

      let nextNumber = 1;
      if (lastExpense && lastExpense.expense_id) {
        const match = String(lastExpense.expense_id).match(/EXP(\d+)/);
        if (match) {
          nextNumber = parseInt(match[1]) + 1;
        }
      }

      const created = [];

      for (let index = 0; index < items.length; index++) {
        const row = items[index] || {};
        const category = normalizeExpenseCategory(row.category);
        const amount = Number(row.amount);
        const expenseDate =
          parseExpenseDateToISO(row.expense_date || row.date) || moment().format('YYYY-MM-DD');
        const description = row.description ? String(row.description).trim() : null;
        const rowClientId = row.client_id ? Number(row.client_id) : null;

        if (!category || !Number.isFinite(amount) || amount <= 0) {
          const err = new Error(`Invalid expense row at index ${index}`);
          err.statusCode = 400;
          throw err;
        }

        if (rowClientId) {
          const rowClient = await assertClientIsAllowed({ companyId, employeeId, userType, clientId: rowClientId });
          if (!rowClient) {
            const err = new Error('Invalid assigned client');
            err.statusCode = 400;
            throw err;
          }
        }

        const expense_id = `EXP${nextNumber.toString().padStart(3, '0')}`;
        nextNumber += 1;

        const file = filesByField[`receipt_${index}`];
        const receiptPath = file
          ? `/uploads/expenses/company_${companyId}/${file.filename}`
          : (row.receipt_path ? String(row.receipt_path) : null);

        await trx('expenses').insert({
          company_id: companyId,
          expense_id,
          employee_id: employeeId,
          employee_name: employeeName,
          ...(canStoreClientId ? { client_id: rowClientId || clientId || null } : {}),
          category,
          amount: parseFloat(amount),
          expense_date: expenseDate,
          description,
          receipt_path: receiptPath,
          status: 'Pending'
        });

        created.push({ expense_id });
      }

      return created;
    });

    return res.status(201).json({
      success: true,
      message: 'Expenses submitted successfully',
      count: inserted.length,
      expenses: inserted,
      client: client ? { id: client.id, client_name: client.client_name } : null
    });
  } catch (error) {
    const statusCode = error?.statusCode || 500;
    console.error('Submit bulk expenses error:', error);
    return res.status(statusCode).json({ message: statusCode === 500 ? 'Server error' : error.message });
  }
};


const getExpenses = async (req, res) => {
  const companyId = req.user.company_id;
  if (!companyId) {
    return res.status(400).json({ message: 'You are not assigned to any company' });
  }

  try {
    const includeClient = await hasExpensesClientIdColumn();
    let expenses;

    // 🔐 ADMIN + FINANCE → All expenses
    if (isPrivilegedExpenseRole(req.user)) {
      let query = knex('expenses as e')
        .join('employees as emp', 'e.employee_id', 'emp.id');

      if (includeClient) {
        query = query.leftJoin('clients as c', 'e.client_id', 'c.id');
      }

      expenses = await query
        .select(
          'e.id',
          'e.expense_id',
          'e.employee_id',
          'e.company_id',
          ...(includeClient ? ['e.client_id'] : []),
          ...(includeClient ? [knex.raw('c.client_name as client_name')] : []),
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
      const employeeId = await resolveExpenseEmployeeId(req, companyId);
      if (!employeeId) {
        return res.json({ success: true, count: 0, expenses: [] });
      }

      let query = knex('expenses as e');

      if (includeClient) {
        query = query.leftJoin('clients as c', 'e.client_id', 'c.id');
      }

      expenses = await query
        .select(
          'e.id',
          'e.expense_id',
          'e.employee_id',
          'e.company_id',
          ...(includeClient ? ['e.client_id'] : []),
          ...(includeClient ? [knex.raw('c.client_name as client_name')] : []),
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
          'e.employee_id': employeeId,
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


const updateExpenseStatus = async (req, res) => {
  const companyId = req.user.company_id;
  if (!companyId) {
    return res.status(400).json({ message: 'You are not assigned to any company' });
  }

  const { expense_id } = req.params;
  const { status } = req.body;

  if (!expense_id) {
    return res.status(400).json({ message: 'Expense ID is required' });
  }

  try {
    console.log('Updating expense:', expense_id, 'Status:', status);

    const expense = await knex('expenses')
      .where({ expense_id, company_id: companyId })
      .first();

    if (!expense) {
      return res.status(404).json({ message: 'Expense not found or access denied' });
    }

    const isAdminOrFinance = isPrivilegedExpenseRole(req.user);
    const actorEmployeeId = await resolveExpenseEmployeeId(req, companyId);
    const isOwner = actorEmployeeId
      ? Number(expense.employee_id) === actorEmployeeId
      : false;

    if (status && ['Approved', 'Rejected'].includes(status)) {
      await knex('expenses')
        .where({ expense_id })
        .update({
          status,
          approved_by: req.user.id,
          approved_at: knex.fn.now()
        });
    } else {
      if (!isAdminOrFinance && !isOwner) {
        return res.status(403).json({ message: 'You are not allowed to edit this expense' });
      }

      if (String(expense.status || '').toLowerCase() !== 'pending' && !isAdminOrFinance) {
        return res.status(400).json({ message: 'Only pending expenses can be edited' });
      }

      const updates = {};
      if (req.body.category !== undefined) {
        updates.category = normalizeExpenseCategory(req.body.category);
      }
      if (req.body.amount !== undefined) {
        const nextAmount = Number(req.body.amount);
        if (!Number.isFinite(nextAmount) || nextAmount <= 0) {
          return res.status(400).json({ message: 'Amount must be greater than 0' });
        }
        updates.amount = nextAmount;
      }
      if (req.body.expense_date || req.body.date) {
        const parsed = parseExpenseDateToISO(req.body.expense_date || req.body.date);
        if (!parsed) {
          return res.status(400).json({ message: 'Invalid expense date format' });
        }
        updates.expense_date = parsed;
      }
      if (req.body.description !== undefined) {
        updates.description = String(req.body.description || '').trim();
      }
      if (req.file) {
        updates.receipt_path = `/uploads/expenses/company_${companyId}/${req.file.filename}`;
      }
      if (String(req.body.remove_receipt || '').toLowerCase() === 'true') {
        updates.receipt_path = null;
      }
      if (req.body.client_id !== undefined) {
        const rowClientId = req.body.client_id ? Number(req.body.client_id) : null;
        if (rowClientId) {
          const client = await assertClientIsAllowed({
            companyId,
            employeeId: actorEmployeeId || req.user.id,
            userType: req.user.type,
            clientId: rowClientId
          });
          if (!client) {
            return res.status(400).json({ message: 'Invalid assigned client' });
          }
        }
        updates.client_id = Number.isFinite(rowClientId) ? rowClientId : null;
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ message: 'No fields to update' });
      }

      await knex('expenses')
        .where({ expense_id })
        .update({
          ...updates,
          updated_at: knex.fn.now()
        });
    }

    const updated = await knex('expenses')
      .where({ expense_id })
      .first();

    if (status && ['Approved', 'Rejected'].includes(status)) {
      const sameDateExpenses = await knex('expenses')
        .where({
          company_id: companyId,
          employee_id: updated.employee_id,
          expense_date: updated.expense_date
        })
        .select(
          'expense_id',
          'expense_date',
          'amount',
          'category',
          'description',
          'status',
          'approved_at'
        );

      const hasPendingExpenseOnSameDate = sameDateExpenses.some(
        (item) => String(item.status || '').toLowerCase() === 'pending'
      );

      const matchingStatusExpenses = sameDateExpenses.filter(
        (item) => String(item.status || '').toLowerCase() === status.toLowerCase()
      );

      const employee = await knex('employees')
        .where({ id: updated.employee_id })
        .first();

      console.log('Employee record:', employee);
      console.log('Email To:', employee?.email);

      if (employee && employee.email && !hasPendingExpenseOnSameDate && matchingStatusExpenses.length > 0) {
        console.log('Trying to send expense status email...');

        try {
          await sendExpenseStatusNotification(
            matchingStatusExpenses,
            {
              employee_email: employee.email,
              employee_name: `${employee.first_name} ${employee.last_name}`
            },
            status.toLowerCase()
          );

          console.log('Mail function completed');
        } catch (mailError) {
          console.error('Mail sending failed:', mailError);
        }
      } else if (hasPendingExpenseOnSameDate) {
        console.log('Skipping expense status email because same-date expenses are still pending.');
      } else {
        console.warn('No employee email found. Skipping mail.');
      }
    }

    res.json({
      success: true,
      message: status && ['Approved', 'Rejected'].includes(status)
        ? `Expense ${status.toLowerCase()} successfully!`
        : 'Expense updated successfully',
      expense: {
        ...updated,
        receipt_url: updated.receipt_path ? `${updated.receipt_path}` : null
      }
    });

  } catch (error) {
    console.error('Update expense error:', error);
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

    const isAdminOrFinance = isPrivilegedExpenseRole(req.user);
    const actorEmployeeId = await resolveExpenseEmployeeId(req, companyId);
    const isOwner = actorEmployeeId
      ? Number(expense.employee_id) === actorEmployeeId
      : false;

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

  const { employeeIds, expenseIds, format, statusFilter, dateFilter } = req.body;

  try {
    const includeClient = await hasExpensesClientIdColumn();
    let query = knex('expenses as e')
      .join('employees as emp', 'e.employee_id', 'emp.id')
      .modify((qb) => {
        if (includeClient) {
          qb.leftJoin('clients as c', function () {
            this.on('e.client_id', '=', 'c.id').andOn('c.company_id', '=', 'e.company_id');
          });
        }
      })
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
        knex.raw("CONCAT(emp.first_name, ' ', emp.last_name) as employee_name"),
        ...(includeClient ? [knex.raw('c.client_name as client_name')] : [knex.raw("'' as client_name")])
      )
      .where('e.company_id', companyId);

    // Apply employee filter if specific employees are selected
    if (employeeIds && employeeIds.length > 0 && !employeeIds.includes('all')) {
      query = query.whereIn('e.employee_id', employeeIds);
    }

    if (Array.isArray(expenseIds) && expenseIds.length > 0) {
      const numericExpenseIds = expenseIds
        .map((id) => Number(id))
        .filter((id) => Number.isInteger(id) && id > 0);
      const codeExpenseIds = expenseIds
        .map((id) => String(id || '').trim())
        .filter((id) => id && !/^\d+$/.test(id));

      query = query.where((qb) => {
        if (numericExpenseIds.length) {
          qb.whereIn('e.id', numericExpenseIds);
        }
        if (codeExpenseIds.length) {
          const method = numericExpenseIds.length ? 'orWhereIn' : 'whereIn';
          qb[method]('e.expense_id', codeExpenseIds);
        }
      });
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

    // Format data for export in the requested claim sheet model.
    const exportData = buildExpenseModelExportRows(expenses);

    if (format === 'csv') {
      const csvHeader = Object.keys(exportData[0] || {}).join(',');
      const csvRows = exportData.map(row =>
        Object.values(row).map(csvEscape).join(',')
      );

      const csvContent = `\uFEFF${[csvHeader, ...csvRows].join('\n')}`;

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename=expense_claim_model_${moment().format('YYYY-MM-DD')}.csv`);
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

const getAssignedClientsForClaims = async (req, res) => {
  try {
    const companyId = req.user.company_id;
    const employeeId = req.user.id;
    const userType = String(req.user.type || '').toLowerCase(); // admin / employee

    if (!companyId) {
      return res.status(400).json({ success: false, message: 'You are not assigned to any company' });
    }

    let query = knex('clients')
      .select('id', 'client_id', 'client_name')
      .where('company_id', companyId)
      .orderBy('client_name', 'asc');

    if (userType === 'employee') {
      const assignedClientCount = await getAssignedClientCountForEmployee({ companyId, employeeId });

      // Employees with at least one assigned client should only see those clients.
      // Employees with no assignment should fall back to the full company client list.
      if (assignedClientCount > 0) {
        await applyEmployeeAssignmentFilter(query, {
          clientTable: 'clients',
          employeeId,
        });
      }
    }

    const clients = await query;

    return res.json({ success: true, clients });
  } catch (error) {
    console.error('Get assigned clients error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

const getExpenseDraft = async (req, res) => {
  try {
    const companyId = req.user.company_id;

    if (!companyId) {
      return res.status(400).json({ success: false, message: 'You are not assigned to any company' });
    }

    const employeeId = await resolveExpenseEmployeeId(req, companyId);
    if (!employeeId) {
      return res.json({ success: true, drafts: [] });
    }

    await ensureExpenseDraftsTable();

    const rows = await knex('expense_drafts')
      .where({ company_id: companyId, employee_id: employeeId })
      .orderBy('updated_at', 'desc')
      .orderBy('id', 'desc');

    if (!rows.length) {
      return res.json({ success: true, drafts: [] });
    }

    const drafts = rows
      .map((row) => {
        let draft = null;
        try {
          draft = JSON.parse(row.draft_data);
        } catch {
          draft = null;
        }

        if (!draft) return null;

        return {
          id: row.id,
          client_id: row.client_id || null,
          expenses: Array.isArray(draft.expenses) ? draft.expenses : [],
          created_at: row.created_at,
          updated_at: row.updated_at
        };
      })
      .filter(Boolean);

    return res.json({
      success: true,
      drafts
    });
  } catch (error) {
    console.error('Get expense draft error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

const saveExpenseDraft = async (req, res) => {
  try {
    const companyId = req.user.company_id;
    const userType = req.user.type;

    if (!companyId) {
      return res.status(400).json({ success: false, message: 'You are not assigned to any company' });
    }

    const employeeId = await resolveExpenseEmployeeId(req, companyId);
    if (!employeeId) {
      return res.status(400).json({
        success: false,
        message:
          'No employee profile is linked to this account. Link the admin email to an employee record to save expense drafts.',
      });
    }

    await ensureExpenseDraftsTable();

    const clientIdRaw = req.body.client_id;
    const clientId = clientIdRaw === null || clientIdRaw === undefined || String(clientIdRaw).trim() === '' ? null : Number(clientIdRaw);
    const draftIdRaw = req.body.draft_id;
    const draftId = draftIdRaw === null || draftIdRaw === undefined || String(draftIdRaw).trim() === '' ? null : Number(draftIdRaw);
    let expenses = req.body.expenses;
    if (typeof expenses === 'string') {
      try {
        expenses = JSON.parse(expenses);
      } catch {
        expenses = [];
      }
    }
    expenses = Array.isArray(expenses) ? expenses : [];

    // if (clientId !== null) {
    //   if (Number.isNaN(clientId)) {
    //     return res.status(400).json({ success: false, message: 'Invalid assigned client' });
    //   }

    //   const client = await assertClientIsAllowed({ companyId, employeeId, userType, clientId });
    //   if (!client) {
    //     return res.status(400).json({ success: false, message: 'Invalid assigned client' });
    //   }
    // }

    if (expenses.length > 25) {
      return res.status(400).json({ success: false, message: 'Too many expenses in one draft (max 25)' });
    }

    const files = Array.isArray(req.files) ? req.files : [];
    const filesByField = {};
    for (const file of files) {
      if (file && file.fieldname) {
        filesByField[file.fieldname] = file;
      }
    }

    const normalized = [];
    for (let index = 0; index < expenses.length; index++) {
      const row = expenses[index] || {};
      const file = filesByField[`receipt_${index}`];
      const receiptPath = file
        ? `/uploads/expenses/company_${companyId}/${file.filename}`
        : row.receipt_path || row.receipt_url || '';
      const rowClientId = row.client_id ? Number(row.client_id) : null;

      if (rowClientId) {
        const client = await assertClientIsAllowed({ companyId, employeeId, userType, clientId: rowClientId });
        if (!client) {
          return res.status(400).json({ success: false, message: 'Invalid assigned client' });
        }
      }

      normalized.push({
        category: row.category ?? '',
        amount: row.amount ?? '',
        expense_date: row.expense_date ?? row.date ?? '',
        description: row.description ?? '',
        receipt_path: receiptPath || null,
        client_id: Number.isFinite(rowClientId) ? rowClientId : null
      });
    }

    const draftData = JSON.stringify({ expenses: normalized });

    if (Number.isFinite(draftId)) {
      const existing = await knex('expense_drafts')
        .where({ id: draftId, company_id: companyId, employee_id: employeeId })
        .first();

      if (!existing) {
        return res.status(404).json({ success: false, message: 'Draft not found' });
      }

      await knex('expense_drafts')
        .where({ id: draftId, company_id: companyId, employee_id: employeeId })
        .update({ client_id: clientId, draft_data: draftData, updated_at: knex.fn.now() });

      return res.json({ success: true, message: 'Draft saved', draft_id: draftId });
    } else {
      const insertResult = await knex('expense_drafts').insert({
        company_id: companyId,
        employee_id: employeeId,
        client_id: clientId,
        draft_data: draftData
      });

      const insertedDraftId = Array.isArray(insertResult) ? insertResult[0] : insertResult;
      return res.json({ success: true, message: 'Draft saved', draft_id: insertedDraftId || null });
    }
  } catch (error) {
    console.error('Save expense draft error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

const deleteExpenseDraft = async (req, res) => {
  try {
    const companyId = req.user.company_id;

    if (!companyId) {
      return res.status(400).json({ success: false, message: 'You are not assigned to any company' });
    }

    const employeeId = await resolveExpenseEmployeeId(req, companyId);
    if (!employeeId) {
      return res.json({ success: true, message: 'Draft cleared' });
    }

    await ensureExpenseDraftsTable();

    const draftIdRaw = req.params.draft_id || req.query.draft_id || req.body?.draft_id;
    const draftId = draftIdRaw === null || draftIdRaw === undefined || String(draftIdRaw).trim() === '' ? null : Number(draftIdRaw);

    const query = knex('expense_drafts').where({ company_id: companyId, employee_id: employeeId });
    if (Number.isFinite(draftId)) {
      query.andWhere({ id: draftId });
    }

    await query.del();

    return res.json({ success: true, message: 'Draft cleared' });
  } catch (error) {
    console.error('Delete expense draft error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

module.exports = {
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
};
