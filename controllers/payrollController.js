// src/controllers/payrollController.js
const knex = require('../db/db');
const fs = require('fs');
const path = require('path');
const handlebars = require('handlebars');
const pdf = require('html-pdf');
const { sendEmailWithAttachment } = require('../utils/mailer'); // SMTP module
const puppeteer = require('puppeteer');




// Helper: Calculate Payable Days (company scoped)
const calculatePayableDays = async (employeeId, month, companyId) => {
  const [year, monthNum] = month.split('-').map(Number);
  const startDate = new Date(year, monthNum - 1, 1);
  const endDate = new Date(year, monthNum, 0);

  // Get attendance records (company scoped)
  const attendance = await knex('attendance')
    .where({ employee_id: employeeId, company_id: companyId })
    .whereBetween('check_in', [startDate.toISOString(), endDate.toISOString()])
    .select('status', 'hours_worked');

  let payableDays = 0;
  attendance.forEach(record => {
    if (record.status === 'present') payableDays += 1;
    if (record.status === 'half') payableDays += 0.5;
  });

  // Add approved paid leaves (company scoped)
  const paidLeaves = await knex('leave_applications')
    .where({
      employee_id: employeeId,
      status: 'approved',
      company_id: companyId
    })
    .whereBetween('from_date', [startDate, endDate])
    .sum('days as total_paid_leaves')
    .first();

  payableDays += paidLeaves.total_paid_leaves || 0;

  return Math.round(payableDays);
};

// Save or Update Salary Structure (company scoped)
const saveSalaryStructure = async (req, res) => {
  const companyId = req.user.company_id;
  if (!companyId) {
    return res.status(400).json({ message: 'You are not assigned to any company' });
  }

  const {
    employee_id,
    basic,
    hra = 0,
    allowances = 0,
    incentives = 0,
    pf = 0,
    esi = 0,
    pt = 0,
    tds = 0,
    other_deductions = 0
  } = req.body;

  if (!employee_id || !basic) {
    return res.status(400).json({ message: 'Employee ID and Basic Salary required' });
  }

  try {
    // First find employee by employee_id (code) to get the actual database ID
    const employeeRecord = await knex('employees')
      .where({ employee_id: employee_id, company_id: companyId })
      .first();

    if (!employeeRecord) {
      return res.status(404).json({ message: 'Employee not found or access denied' });
    }

    // Use the actual database ID for further operations
    const actualEmployeeId = employeeRecord.id;

    const gross = Number(basic) + Number(hra) + Number(allowances) + Number(incentives);
    const deductions = Number(pf) + Number(esi) + Number(pt) + Number(tds) + Number(other_deductions);

    const existing = await knex('payroll_structures')
      .where({ employee_id: actualEmployeeId, company_id: companyId })
      .first();

    if (existing) {
      // UPDATE
      await knex('payroll_structures')
        .where({ employee_id: actualEmployeeId, company_id: companyId })
        .update({
          basic: Number(basic),
          hra: Number(hra),
          allowances: Number(allowances),
          incentives: Number(incentives),
          gross,
          pf: Number(pf),
          esi: Number(esi),
          pt: Number(pt),
          tds: Number(tds),
          other_deductions: Number(other_deductions)
        });

      const updated = await knex('payroll_structures')
        .where({ employee_id: actualEmployeeId, company_id: companyId })
        .first();

      res.json({
        success: true,
        message: 'Salary structure updated successfully',
        structure: updated
      });
    } else {
      // CREATE
      await knex('payroll_structures').insert({
        company_id: companyId,
        employee_id: actualEmployeeId,
        basic: Number(basic),
        hra: Number(hra),
        allowances: Number(allowances),
        incentives: Number(incentives),
        gross,
        pf: Number(pf),
        esi: Number(esi),
        pt: Number(pt),
        tds: Number(tds),
        other_deductions: Number(other_deductions)
      });

      const newStructure = await knex('payroll_structures')
        .where({ employee_id: actualEmployeeId, company_id: companyId })
        .first();

      res.json({
        success: true,
        message: 'Salary structure created successfully',
        structure: newStructure
      });
    }

  } catch (error) {
    console.error('Save salary structure error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};


// const processPayroll = async (req, res) => {
//   const companyId = req.user.company_id;

//   if (!companyId) {
//     return res.status(400).json({ message: 'You are not assigned to any company' });
//   }

//   const { employee_id, month } = req.body;

//   if (!employee_id || !month) {
//     return res.status(400).json({ message: 'Employee ID and Month required' });
//   }

//   try {
//     // ===============================
//     // EMPLOYEE FETCH
//     // ===============================
//     const employee = await knex('employees')
//       .where(function () {
//         if (!isNaN(employee_id)) {
//           this.where('id', employee_id);
//         } else {
//           this.where('employee_id', employee_id);
//         }
//       })
//       .andWhere('company_id', companyId)
//       .first();

//     if (!employee) {
//       return res.status(404).json({ message: 'Employee not found' });
//     }

//     const empId = employee.id;

//     // ===============================
//     // DEPARTMENT & DESIGNATION
//     // ===============================
//     const department = await knex('departments')
//       .where({ id: employee.department_id, company_id: companyId })
//       .first();

//     const designation = await knex('designations')
//       .where({ id: employee.designation_id, company_id: companyId })
//       .first();

//     // ===============================
//     // BANK DETAILS
//     // ===============================
//     const bankDetails = await knex('employee_bank_details')
//       .where({ employee_id: empId, company_id: companyId })
//       .first();

//     // ===============================
//     // SALARY STRUCTURE
//     // ===============================
//     const structure = await knex('payroll_structures')
//       .where({ employee_id: empId, company_id: companyId })
//       .first();

//     if (!structure) {
//       return res.status(400).json({ message: 'Salary structure not found' });
//     }

//     // ===============================
//     // MONTH DAYS
//     // ===============================
//     const [year, monthNum] = month.split('-').map(Number);
//     const totalDays = new Date(year, monthNum, 0).getDate();

//     // ===============================
//     // APPROVED LEAVES
//     // ===============================
//     const approvedLeaves = await knex('leave_applications')
//       .where({
//         employee_id: empId,
//         company_id: companyId,
//         status: 'approved'
//       })
//       .andWhereRaw('MONTH(from_date) = ? AND YEAR(from_date) = ?', [monthNum, year]);

//     const leaveDays = approvedLeaves.reduce((sum, l) => sum + Number(l.days || 0), 0);

//     // ===============================
//     // PRESENT / LOP
//     // ===============================
//     const lopDays = 0;
//     const presentDays = totalDays - leaveDays - lopDays;
//     const payableDays = presentDays;

//     // ===============================
//     // MONTHLY CALCULATION
//     // ===============================
//     const monthlyGross = Number(structure.gross);
//     const dailyGross = monthlyGross / totalDays;
//     const lopAmount = Math.round(dailyGross * lopDays);

//     const monthlyDeductions =
//       Number(structure.pf || 0) +
//       Number(structure.esi || 0) +
//       Number(structure.pt || 0) +
//       Number(structure.tds || 0) +
//       Number(structure.other_deductions || 0);

//     // ===============================
//     // EXPENSES
//     // ===============================
//     const expenses = await knex('expenses')
//       .where({ employee_id: empId, company_id: companyId, status: 'approved' })
//       .andWhereRaw('MONTH(expense_date) = ? AND YEAR(expense_date) = ?', [monthNum, year]);

//     const totalExpenses = expenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);

//     const monthlyNet =
//       monthlyGross - monthlyDeductions - lopAmount + totalExpenses;

//     // ===============================
//     // ANNUAL CALCULATION
//     // ===============================
//     const annualGross = monthlyGross * 12;
//     const annualDeductions = monthlyDeductions * 12;
//     const annualNet = annualGross - annualDeductions;

//     // ===============================
//     // PAYROLL SAVE
//     // ===============================
//     const payrollData = {
//       employee_id: empId,
//       company_id: companyId,
//       month,
//       total_days: totalDays,
//       present_days: presentDays,
//       payable_days: payableDays,
//       approved_leave_days: leaveDays,
//       lop_days: lopDays,
//       lop_amount: lopAmount,
//       gross: monthlyGross,
//       deductions: monthlyDeductions,
//       net: monthlyNet,
//       total_expenses: totalExpenses,
//       annual_gross: annualGross,
//       annual_deductions: annualDeductions,
//       annual_net: annualNet,
//       status: 'processed'
//     };

//     const existing = await knex('payroll_processing')
//       .where({ employee_id: empId, company_id: companyId, month })
//       .first();

//     if (existing) {
//       await knex('payroll_processing').where({ id: existing.id }).update(payrollData);
//     } else {
//       await knex('payroll_processing').insert(payrollData);
//     }

//     // ===============================
//     // COMPANY DETAILS + LOGO BASE64
//     // ===============================
//     const company = await knex('companies').where({ id: companyId }).first();

//    let companyLogoBase64 = null;

// if (company?.logo) {
//   // remove leading slash if exists
//   const relativeLogoPath = company.logo.replace(/^\/+/, '');

//   // ⬅️ GO ONE LEVEL UP FROM backend
//   const logoPath = path.join(
//     process.cwd(),
//     '..',                   // <-- this is the FIX
//     relativeLogoPath
//   );

//   console.log('Resolved Logo Path:', logoPath);

//   if (fs.existsSync(logoPath)) {
//     const ext = path.extname(logoPath).toLowerCase();
//     const mimeType =
//       ext === '.png' ? 'image/png' :
//       ext === '.svg' ? 'image/svg+xml' :
//       'image/jpeg';

//     const buffer = fs.readFileSync(logoPath);
//     companyLogoBase64 = `data:${mimeType};base64,${buffer.toString('base64')}`;
//   } else {
//     console.log('❌ Logo file not found at:', logoPath);
//   }
// }

// console.log('Company Logo Base64 Ready:', !!companyLogoBase64);


//     // ===============================
//     // PDF GENERATION
//     // ===============================
//     const templatePath = path.join(__dirname, '..', 'templates', 'payslip.hbs');
//     const template = handlebars.compile(fs.readFileSync(templatePath, 'utf-8'));

//     const html = template({
//       company_name: company.company_name,
//       company_logo: companyLogoBase64,
//       company_address: company.address,

//       employee_name: `${employee.first_name} ${employee.last_name || ''}`,
//       department_name: department?.name || '-',
//       designation_name: designation?.name || '-',

//       esi_number: employee.esic || '',
//       uan_number: employee.uan || '',

//       bank_name: bankDetails?.bank_name || '',
//       account_no: bankDetails?.account_number || '',
//       ifsc_code: bankDetails?.ifsc_code || '',

//       month,
//       total_days: totalDays,
//       present_days: presentDays,
//       payable_days: payableDays,
//       approved_leave_days: leaveDays,
//       lop_days: lopDays,

//       basic: structure.basic,
//       hra: structure.hra,
//       allowances: structure.allowances,
//       incentives: structure.incentives,
//       total_expenses: totalExpenses,

//       pf: structure.pf,
//       esi: structure.esi,
//       pt: structure.pt,
//       tds: structure.tds,
//       other_deductions: structure.other_deductions,

//       monthly_net: monthlyNet,
//       monthly_deductions: monthlyDeductions,
//       annual_gross: annualGross,
//       annual_deductions: annualDeductions,
//       annual_net: annualNet
//     });

//     const pdfDir = path.join(__dirname, 'temp');
//     if (!fs.existsSync(pdfDir)) fs.mkdirSync(pdfDir, { recursive: true });

//     const pdfPath = path.join(pdfDir, `payslip-${empId}-${month}.pdf`);

//     const browser = await puppeteer.launch({ headless: true });
//     const page = await browser.newPage();
//     await page.setContent(html, { waitUntil: 'networkidle0' });
//     await page.pdf({ path: pdfPath, format: 'A4', printBackground: true });
//     await browser.close();

//     await sendEmailWithAttachment(
//       employee.email,
//       `Payslip for ${month}`,
//       `Dear ${employee.first_name}, Please find your payslip attached.`,
//       pdfPath,
//       `payslip-${month}.pdf`
//     );

//     fs.unlinkSync(pdfPath);

//     return res.json({
//       success: true,
//       message: 'Payroll processed successfully',
//       payroll: payrollData
//     });

//   } catch (error) {
//     console.error('Process payroll error:', error);
//     return res.status(500).json({ message: 'Server error', error: error.message });
//   }
// };


const processPayroll = async (req, res) => {
  const companyId = req.user.company_id;

  if (!companyId) {
    return res.status(400).json({ message: 'You are not assigned to any company' });
  }

  const { employee_id, month } = req.body;

  if (!employee_id || !month) {
    return res.status(400).json({ message: 'Employee ID and Month required' });
  }

  try {
    // ===============================
    // EMPLOYEE
    // ===============================
    const employee = await knex('employees')
      .where(function () {
        if (!isNaN(employee_id)) {
          this.where('id', employee_id);
        } else {
          this.where('employee_id', employee_id);
        }
      })
      .andWhere('company_id', companyId)
      .first();

    if (!employee) {
      return res.status(404).json({ message: 'Employee not found' });
    }

    const empId = employee.id;

    // ===============================
    // DEPARTMENT & DESIGNATION
    // ===============================
    const department = await knex('departments')
      .where({ id: employee.department_id, company_id: companyId })
      .first();

    const designation = await knex('designations')
      .where({ id: employee.designation_id, company_id: companyId })
      .first();

    // ===============================
    // BANK DETAILS
    // ===============================
    const bankDetails = await knex('employee_bank_details')
      .where({ employee_id: empId, company_id: companyId })
      .first();

    // ===============================
    // SALARY STRUCTURE
    // ===============================
    const structure = await knex('payroll_structures')
      .where({ employee_id: empId, company_id: companyId })
      .first();

    if (!structure) {
      return res.status(400).json({ message: 'Salary structure not found' });
    }

    // ===============================
    // MONTH INFO
    // ===============================
    const [year, monthNum] = month.split('-').map(Number);
    const totalDays = new Date(year, monthNum, 0).getDate();
    const startDate = new Date(year, monthNum - 1, 1);
    const endDate = new Date(year, monthNum, 0);

    // ===============================
    // MONTHLY GROSS
    // ===============================
    const monthlyGross = Number(
      structure.gross ??
        Number(structure.basic || 0) +
          Number(structure.hra || 0) +
          Number(structure.allowances || 0) +
          Number(structure.incentives || 0)
    );

    // ===============================
    // ATTENDANCE (PRESENT)
    // ===============================
    const attendanceDays = await knex('attendance')
      .where({
        employee_id: empId,
        company_id: companyId,
      })
      .whereIn('status', ['present', 'late'])
      .whereNotNull('check_in')
      .andWhereRaw('MONTH(check_in) = ? AND YEAR(check_in) = ?', [monthNum, year])
      .select(knex.raw("DATE(check_in) as day"))
      .groupBy('day');

    const presentDays = attendanceDays.length;
    const presentDateSet = new Set(
      attendanceDays
        .map((r) => (r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day).slice(0, 10)))
        .filter(Boolean)
    );

    const holidayRows = await knex('holidays')
      .where({ company_id: companyId })
      .andWhereRaw('MONTH(date) = ? AND YEAR(date) = ?', [monthNum, year])
      .select(knex.raw("DATE_FORMAT(date, '%Y-%m-%d') as day"));

    const holidayDateSet = new Set(holidayRows.map((r) => r.day).filter(Boolean));

    const isWeekend = (d) => {
      const day = d.getDay();
      return day === 0 || day === 6;
    };

    // ===============================
    // APPROVED LEAVES (PAID)
    // ===============================
    const approvedLeaves = await knex('leave_applications')
      .where({
        employee_id: empId,
        company_id: companyId,
        status: 'approved'
      })
      .andWhereRaw(
        '(MONTH(from_date) = ? AND YEAR(from_date) = ?) OR (MONTH(to_date) = ? AND YEAR(to_date) = ?)',
        [monthNum, year, monthNum, year]
      )
      .select('from_date', 'to_date');

    const leaveDateSet = new Set();
    for (const l of approvedLeaves) {
      const from = new Date(l.from_date);
      const to = new Date(l.to_date);

      const current = new Date(Math.max(from.getTime(), startDate.getTime()));
      const end = new Date(Math.min(to.getTime(), endDate.getTime()));
      current.setHours(0, 0, 0, 0);
      end.setHours(0, 0, 0, 0);

      while (current <= end) {
        const key = current.toISOString().slice(0, 10);
        if (!isWeekend(current) && !holidayDateSet.has(key)) {
          leaveDateSet.add(key);
        }
        current.setDate(current.getDate() + 1);
      }
    }

    const approvedLeaveDays = leaveDateSet.size;

    // ===============================
    // PAYABLE & LOP
    // ===============================
    let workingDays = 0;
    for (let day = 1; day <= totalDays; day++) {
      const d = new Date(year, monthNum - 1, day);
      const key = d.toISOString().slice(0, 10);
      if (!isWeekend(d) && !holidayDateSet.has(key)) {
        workingDays++;
      }
    }

    let payableDays = 0;
    for (let day = 1; day <= totalDays; day++) {
      const d = new Date(year, monthNum - 1, day);
      const key = d.toISOString().slice(0, 10);
      if (isWeekend(d) || holidayDateSet.has(key)) {
        continue;
      }

      if (presentDateSet.has(key) || leaveDateSet.has(key)) {
        payableDays++;
      }
    }

    let lopDays = workingDays - payableDays;
    if (lopDays < 0) lopDays = 0;

    // Fix: Don't deduct entire salary if employee has 0 present days
    // LOP should only apply if there are some present days
    let lopAmount = 0;
    if (lopDays > 0) {
      const dailyGross = monthlyGross / totalDays;
      lopAmount = Math.round(dailyGross * lopDays);
    }

    const monthlyDeductions =
      Number(structure.pf || 0) +
      Number(structure.esi || 0) +
      Number(structure.pt || 0) +
      Number(structure.tds || 0) +
      Number(structure.other_deductions || 0);

    // ===============================
    // EXPENSES
    // ===============================
    const expenses = await knex('expenses')
      .where({ employee_id: empId, company_id: companyId, status: 'approved' })
      .andWhereRaw('MONTH(expense_date) = ? AND YEAR(expense_date) = ?', [monthNum, year]);

    const totalExpenses = expenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);

    let monthlyNet =
      monthlyGross - monthlyDeductions - lopAmount + totalExpenses;

    // Ensure net doesn't go negative due to calculation errors
    if (monthlyNet < 0) {
      console.warn(`Negative net salary calculated for employee ${empId}: ${monthlyNet}`);
      console.warn(`Gross: ${monthlyGross}, Deductions: ${monthlyDeductions}, LOP: ${lopAmount}, Expenses: ${totalExpenses}`);
      
      // Fix: Set net to 0 if it goes negative (employee can't have negative salary)
      monthlyNet = 0;
    }

    // ===============================
    // ANNUAL
    // ===============================
    const annualGross = monthlyGross * 12;
    const annualDeductions = monthlyDeductions * 12;
    const annualNet = annualGross - annualDeductions;

    // ===============================
    // SAVE PAYROLL
    // ===============================
    const payrollData = {
      employee_id: empId,
      company_id: companyId,
      month,
      total_days: totalDays,
      present_days: presentDays,
      approved_leave_days: approvedLeaveDays,
      payable_days: payableDays,
      lop_days: lopDays,
      lop_amount: lopAmount,
      gross: monthlyGross,
      deductions: monthlyDeductions,
      net: monthlyNet,
      total_expenses: totalExpenses,
      annual_gross: annualGross,
      annual_deductions: annualDeductions,
      annual_net: annualNet,
      status: 'processed'
    };

    const existing = await knex('payroll_processing')
      .where({ employee_id: empId, company_id: companyId, month })
      .first();

    if (existing) {
      await knex('payroll_processing').where({ id: existing.id }).update(payrollData);
    } else {
      await knex('payroll_processing').insert(payrollData);
    }

    // ===============================
    // COMPANY + LOGO
    // ===============================
    const company = await knex('companies').where({ id: companyId }).first();
    let companyLogoBase64 = null;

    if (company?.logo) {
      const logoPath = path.join(process.cwd(), '..', company.logo.replace(/^\/+/, ''));
      if (fs.existsSync(logoPath)) {
        const buffer = fs.readFileSync(logoPath);
        companyLogoBase64 = `data:image/png;base64,${buffer.toString('base64')}`;
      }
    }

    // ===============================
    // PDF GENERATION
    // ===============================
    const templatePath = path.join(__dirname, '..', 'templates', 'payslip.hbs');
    const template = handlebars.compile(fs.readFileSync(templatePath, 'utf-8'));

    const html = template({
      company_name: company.company_name,
      company_logo: companyLogoBase64,
      company_address: company.address,

      employee_name: `${employee.first_name} ${employee.last_name || ''}`,
      department_name: department?.name || '-',
      designation_name: designation?.name || '-',

      esi_number: employee.esic || '',
      uan_number: employee.uan || '',

      bank_name: bankDetails?.bank_name || '',
      account_no: bankDetails?.account_number || '',
      ifsc_code: bankDetails?.ifsc_code || '',

      month,
      total_days: totalDays,
      present_days: presentDays,
      approved_leave_days: approvedLeaveDays,
      lop_days: lopDays,
      payable_days: payableDays,

      basic: structure.basic,
      hra: structure.hra,
      allowances: structure.allowances,
      incentives: structure.incentives,
      total_expenses: totalExpenses,

      pf: structure.pf,
      esi: structure.esi,
      pt: structure.pt,
      tds: structure.tds,
      other_deductions: structure.other_deductions,

      monthly_net: monthlyNet,
      monthly_deductions: monthlyDeductions,
      annual_gross: annualGross,
      annual_deductions: annualDeductions,
      annual_net: annualNet
    });

    const pdfDir = path.join(__dirname, 'temp');
    if (!fs.existsSync(pdfDir)) fs.mkdirSync(pdfDir, { recursive: true });

    const pdfPath = path.join(pdfDir, `payslip-${empId}-${month}.pdf`);

    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.pdf({ path: pdfPath, format: 'A4', printBackground: true });
    await browser.close();

    // ===============================
    // SEND EMAIL
    // ===============================
    await sendEmailWithAttachment(
      employee.email,
      `Payslip for ${month}`,
      `Dear ${employee.first_name}, Please find your payslip attached.`,
      pdfPath,
      `payslip-${month}.pdf`
    );

    fs.unlinkSync(pdfPath);

    return res.json({
      success: true,
      message: 'Payroll processed & email sent successfully',
      payroll: payrollData
    });

  } catch (error) {
    console.error('Process payroll error:', error);
    return res.status(500).json({ message: 'Server error', error: error.message });
  }
};




const updatePayrollStatus = async (req, res) => {
  const companyId = req.user.company_id;
  if (!companyId) {
    return res.status(400).json({ message: 'You are not assigned to any company' });
  }

  const { id } = req.params;
  const { status } = req.body;

  if (!['draft', 'processed', 'paid'].includes(status)) {
    return res.status(400).json({ message: 'Invalid status' });
  }

  try {
    const payroll = await knex('payroll_processing')
      .where({ id, company_id: companyId })
      .first();

    if (!payroll) {
      return res.status(404).json({ message: 'Payroll record not found or access denied' });
    }

    await knex('payroll_processing')
      .where({ id })
      .update({ status });

    const updated = await knex('payroll_processing').where({ id }).first();

    res.json({
      success: true,
      message: `Payroll status updated to ${status}`,
      payroll: updated
    });

  } catch (error) {
    console.error('Update payroll status error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Get Payroll Records (company scoped + role-based)
const getPayrollRecords = async (req, res) => {
  const companyId = req.user.company_id;
  if (!companyId) {
    return res.status(400).json({ message: 'You are not assigned to any company' });
  }

  try {
    let query = knex('payroll_processing')
      .leftJoin('employees', 'payroll_processing.employee_id', 'employees.id')
      .where('payroll_processing.company_id', companyId)
      .select(
        'payroll_processing.*',
        'employees.first_name',
        'employees.last_name'
      )
      .orderBy('month', 'desc');

    if (req.user.role === 'employee') {
      query = query.where('payroll_processing.employee_id', req.user.id);
    } else if (req.user.role === 'manager') {
      query = query.where(builder => {
        builder.where('payroll_processing.employee_id', req.user.id)
          .orWhereExists(function() {
            this.select(1)
              .from('employees as team')
              .where('team.company_id', companyId)
              .whereRaw('team.manager_name = CONCAT(?, " ", COALESCE(?, ""))', 
                [req.user.first_name || '', req.user.last_name || ''])
              .whereRaw('team.id = payroll_processing.employee_id');
          });
      });
    }
    // Admin/HR/Finance sees all in company

    const records = await query;

    res.json({
      success: true,
      payrolls: records
    });

  } catch (error) {
    console.error('Get payroll error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};


// const payslipPreview = async (req, res) => {
//   const companyId = req.user.company_id;
//   const { employee_id, month } = req.params;

//   if (!companyId) {
//     return res.status(400).json({ message: 'Company not assigned' });
//   }

//   try {
//     // ===============================
//     // EMPLOYEE (FIXED)
//     // ===============================
//     const employee = await knex('employees')
//       .where({ id: employee_id, company_id: companyId })
//       .first();

//     if (!employee) {
//       return res.status(404).json({ message: 'Employee not found' });
//     }

//     // ===============================
//     // BANK DETAILS
//     // ===============================
//     const bankDetails = await knex('employee_bank_details')
//       .where({ employee_id, company_id: companyId })
//       .first();

//     // ===============================
//     // PAYROLL DATA
//     // ===============================
//     const payroll = await knex('payroll_processing')
//       .where({ employee_id, company_id: companyId, month })
//       .first();

//     if (!payroll) {
//       return res.status(404).json({
//         message: 'Payroll not processed for this month'
//       });
//     }

//     // ===============================
//     // SALARY STRUCTURE
//     // ===============================
//     const structure = await knex('payroll_structures')
//       .where({ employee_id, company_id: companyId })
//       .first();


    
//     // ===============================
//     // COMPANY
//     // ===============================
//     const company = await knex('companies')
//       .where({ id: companyId })
//       .first();


//       let companyLogoBase64 = null;

// if (company?.logo) {
//   // remove leading slash if exists
//   const relativeLogoPath = company.logo.replace(/^\/+/, '');

//   // ⬅️ GO ONE LEVEL UP FROM backend
//   const logoPath = path.join(
//     process.cwd(),
//     '..',                   // <-- this is the FIX
//     relativeLogoPath
//   );

//   console.log('Resolved Logo Path:', logoPath);

//   if (fs.existsSync(logoPath)) {
//     const ext = path.extname(logoPath).toLowerCase();
//     const mimeType =
//       ext === '.png' ? 'image/png' :
//       ext === '.svg' ? 'image/svg+xml' :
//       'image/jpeg';

//     const buffer = fs.readFileSync(logoPath);
//     companyLogoBase64 = `data:${mimeType};base64,${buffer.toString('base64')}`;
//   } else {
//     console.log('❌ Logo file not found at:', logoPath);
//   }
// }   

// const department = await knex('departments')
//       .where({ id: companyId })
//       .first();


//       const designation = await knex('designations')
//       .where({ id: companyId })
//       .first();
//     // ===============================
//     // TEMPLATE DATA
//     // ===============================
//     const templateData = {
//       company_name: company.company_name,
//       company_logo: companyLogoBase64,
//       company_address: company.address,

//       employee_name: `${employee.first_name} ${employee.last_name || ''}`,
//       department_name: department?.name || '-',
//       designation_name: designation?.name || '-',

//       esi_number: employee.esic || '',
//       uan_number: employee.uan || '',

//       bank_name: bankDetails?.bank_name || '',
//       account_no: bankDetails?.account_number || '',
//       ifsc_code: bankDetails?.ifsc_code || '',

//       month,
//       total_days: totalDays,
//       present_days: presentDays,
//       payable_days: payableDays,
//       approved_leave_days: leaveDays,
//       lop_days: lopDays,

//       basic: structure.basic,
//       hra: structure.hra,
//       allowances: structure.allowances,
//       incentives: structure.incentives,
//       total_expenses: totalExpenses,

//       pf: structure.pf,
//       esi: structure.esi,
//       pt: structure.pt,
//       tds: structure.tds,
//       other_deductions: structure.other_deductions,

//       monthly_net: monthlyNet,
//       monthly_deductions: monthlyDeductions,
//       annual_gross: annualGross,
//       annual_deductions: annualDeductions,
//       annual_net: annualNet
//     };

//     const templatePath = path.join(__dirname, '..', 'templates', 'payslip.hbs');
//     const templateHtml = fs.readFileSync(templatePath, 'utf-8');
//     const template = handlebars.compile(templateHtml);

//     const html = template(templateData);

//     res.setHeader('Content-Type', 'text/html');
//     return res.send(html);

//   } catch (error) {
//     console.error('Payslip preview error:', error);
//     return res.status(500).json({
//       message: 'Server error',
//       error: error.message
const payslipPreview = async (req, res) => {
  const companyId = req.user.company_id;
  const { employee_id, month } = req.params;

  if (!companyId) {
    return res.status(400).json({ message: 'You are not assigned to any company' });
  }

  // 🔒 Employee access control
  if (req.user.role === 'employee' && employee_id != req.user.id) {
    return res.status(403).json({ message: 'Access denied' });
  }

  try {
    // ===============================
    // EMPLOYEE FETCH (same logic as POST)
    // ===============================
    const employee = await knex('employees')
      .where(function () {
        if (!isNaN(employee_id)) {
          this.where('id', employee_id);
        } else {
          this.where('employee_id', employee_id);
        }
      })
      .andWhere('company_id', companyId)
      .first();

    if (!employee) {
      return res.status(404).json({ message: 'Employee not found' });
    }

    const empId = employee.id;

    // ===============================
    // PAYROLL DATA (🔥 MAIN SOURCE)
    // ===============================
    const payroll = await knex('payroll_processing')
      .where({ employee_id: empId, company_id: companyId, month })
      .first();

    if (!payroll) {
      return res.status(404).json({
        message: 'Payroll not processed for this month'
      });
    }

    // ===============================
    // DEPARTMENT & DESIGNATION
    // ===============================
    const department = await knex('departments')
      .where({ id: employee.department_id, company_id: companyId })
      .first();

    const designation = await knex('designations')
      .where({ id: employee.designation_id, company_id: companyId })
      .first();

    // ===============================
    // BANK DETAILS
    // ===============================
    const bankDetails = await knex('employee_bank_details')
      .where({ employee_id: empId, company_id: companyId })
      .first();
    
     const structure = await knex('payroll_structures')
      .where({ employee_id: empId, company_id: companyId })
      .first();

    // ===============================
    // COMPANY + LOGO BASE64
    // ===============================
    const company = await knex('companies')
      .where({ id: companyId })
      .first();

    let companyLogoBase64 = null;

    if (company?.logo) {
      const relativeLogoPath = company.logo.replace(/^\/+/, '');
      const logoPath = path.join(process.cwd(), '..', relativeLogoPath);

      if (fs.existsSync(logoPath)) {
        const ext = path.extname(logoPath).toLowerCase();
        const mimeType =
          ext === '.png' ? 'image/png' :
          ext === '.svg' ? 'image/svg+xml' :
          'image/jpeg';

        const buffer = fs.readFileSync(logoPath);
        companyLogoBase64 = `data:${mimeType};base64,${buffer.toString('base64')}`;
      }
    }

    // ===============================
    // TEMPLATE DATA (🔥 SAME FIELDS)
    // ===============================
    const templateData = {
      company_name: company.company_name,
      company_logo: companyLogoBase64,
      company_address: company.address,

      employee_name: `${employee.first_name} ${employee.last_name || ''}`,
      department_name: department?.name || '-',
      designation_name: designation?.name || '-',

      esi_number: employee.esic || '',
      uan_number: employee.uan || '',

      bank_name: bankDetails?.bank_name || '',
      account_no: bankDetails?.account_number || '',
      ifsc_code: bankDetails?.ifsc_code || '',

      month,
      total_days: payroll.total_days,
      present_days: payroll.present_days,
      payable_days: payroll.payable_days,
      approved_leave_days: payroll.approved_leave_days,
      lop_days: payroll.lop_days,

      // 🔥 Salary Snapshot (from payroll_processing)
      basic: structure?.basic || 0,
      hra: structure?.hra,
      allowances: structure?.allowances,
      incentives: structure?.incentives,
      total_expenses: structure?.total_expenses,

      pf: structure?.pf,
      esi: structure?.esi,
      pt: structure?.pt,
      tds: structure?.tds,
      other_deductions: structure?.other_deductions,

      monthly_net: payroll.net,
      monthly_deductions: payroll.deductions,
      annual_gross: payroll.annual_gross,
      annual_deductions: payroll.annual_deductions,
      annual_net: payroll.annual_net
    };

    // ===============================
    // HTML PREVIEW
    // ===============================
    const templatePath = path.join(__dirname, '..', 'templates', 'payslip.hbs');
    const template = handlebars.compile(fs.readFileSync(templatePath, 'utf-8'));

    const html = template(templateData);

    res.setHeader('Content-Type', 'text/html');
    return res.send(html);

  } catch (error) {
    console.error('Payslip preview error:', error);
    return res.status(500).json({
      message: 'Server error',
      error: error.message
    });
  }
};




const getSalaryStructures = async (req, res) => {
  const companyId = req.user.company_id;
  if (!companyId) {
    return res.status(400).json({ message: 'You are not assigned to any company' });
  }

  try {
    const salaryStructures = await knex('payroll_structures')
      .where({ company_id: companyId })
      .select(
       '*'
      )
      .orderBy('created_at', 'desc');

    // Get employee details for each structure
    const structuresWithEmployeeDetails = await Promise.all(
      salaryStructures.map(async (structure) => {
        const employee = await knex('employees')
          .where({ id: structure.employee_id, company_id: companyId })
          .select('first_name', 'last_name', 'employee_id as emp_id')
          .first();
          
        return {
          ...structure,
          employee_name: employee ? `${employee.first_name} ${employee.last_name}` : 'N/A',
          employee_code: employee?.emp_id || 'N/A'
        };
      })
    );

    res.json(structuresWithEmployeeDetails);
  } catch (error) {
    console.error('Error fetching salary structures:', error);
    res.status(500).json({ message: 'Error fetching salary structures', error: error.message });
  }
};


const updateSalaryStructure = async (req, res) => {
  const companyId = req.user.company_id;
  const { id } = req.params; // payroll_structures.id

  if (!companyId) {
    return res.status(400).json({ message: 'You are not assigned to any company' });
  }

  const {
    basic,
    hra = 0,
    allowances = 0,
    incentives = 0,
    pf = 0,
    esi = 0,
    pt = 0,
    tds = 0,
    other_deductions = 0
  } = req.body;

  if (!basic) {
    return res.status(400).json({ message: 'Basic salary is required' });
  }

  try {
    // Check structure exists for this company
    const structure = await knex('payroll_structures')
      .where({ id, company_id: companyId })
      .first();

    if (!structure) {
      return res.status(404).json({ message: 'Salary structure not found or access denied' });
    }

    const gross =
      Number(basic) +
      Number(hra) +
      Number(allowances) +
      Number(incentives);

    const deductions =
      Number(pf) +
      Number(esi) +
      Number(pt) +
      Number(tds) +
      Number(other_deductions);

    await knex('payroll_structures')
      .where({ id, company_id: companyId })
      .update({
        basic: Number(basic),
        hra: Number(hra),
        allowances: Number(allowances),
        incentives: Number(incentives),
        gross,
        pf: Number(pf),
        esi: Number(esi),
        pt: Number(pt),
        tds: Number(tds),
        other_deductions: Number(other_deductions),
        updated_at: knex.fn.now()
      });

    const updated = await knex('payroll_structures')
      .where({ id, company_id: companyId })
      .first();

    res.json({
      success: true,
      message: 'Salary structure updated successfully',
      structure: updated
    });
  } catch (error) {
    console.error('Update salary structure error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

const deleteSalaryStructure = async (req, res) => {
  const companyId = req.user.company_id;
  const { id } = req.params; // payroll_structures.id

  if (!companyId) {
    return res.status(400).json({ message: 'You are not assigned to any company' });
  }

  try {
    // Check structure exists for this company
    const structure = await knex('payroll_structures')
      .where({ id, company_id: companyId })
      .first();

    if (!structure) {
      return res.status(404).json({ message: 'Salary structure not found or access denied' });
    }

    // Optional safety check: prevent delete if payroll already processed
    // const payrollExists = await knex('payrolls')
    //   .where({ employee_id: structure.employee_id, company_id: companyId })
    //   .first();
    // if (payrollExists) {
    //   return res.status(400).json({ message: 'Cannot delete salary structure with processed payroll' });
    // }

    await knex('payroll_structures')
      .where({ id, company_id: companyId })
      .del();

    res.json({
      success: true,
      message: 'Salary structure deleted successfully'
    });
  } catch (error) {
    console.error('Delete salary structure error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};


// Get Employee Payslips (for employees to see their own payslips only)
const getEmployeePayslips = async (req, res) => {
  const companyId = req.user.company_id;
  if (!companyId) {
    return res.status(400).json({ message: 'You are not assigned to any company' });
  }

  try {
    const records = await knex('payroll_processing')
      .leftJoin(
        'employees',
        'payroll_processing.employee_id',
        'employees.id'
      )
      .where('payroll_processing.employee_id', req.user.id)
      .where('payroll_processing.company_id', companyId)
      .select(
        'payroll_processing.*',
        'employees.first_name',
        'employees.last_name'
      )
      .orderBy('payroll_processing.month', 'desc');

    console.log('Records from DB:', records);
    console.log('User ID:', req.user.id);
    console.log('Company ID:', companyId);
    console.log('Query result count:', records.length);

    const transformedRecords = records.map(record => ({
      id: record.id.toString(),
      employeeId: record.employee_id.toString(),
      employeeName: `${record.first_name || ''} ${record.last_name || ''}`.trim(),
      month: record.month,
      payableDays: record.payable_days || 0,
      lopAmount: parseFloat(record.lop_amount) || 0,
      gross: parseFloat(record.gross) || 0,
      deductions: parseFloat(record.deductions) || 0,
      net: parseFloat(record.net) || 0,
      status: record.status || 'draft',
      createdAt: record.created_at || new Date().toISOString(),
    }));

    res.json({
      success: true,
      payrolls: transformedRecords
    });

  } catch (error) {
    console.error('Get employee payslips error:', error);
    res.status(500).json({
      message: 'Server error',
      error: error.message
    });
  }
};

module.exports = {
  saveSalaryStructure,
  getSalaryStructures,
  processPayroll,
  updatePayrollStatus,
  getPayrollRecords,
  payslipPreview,
  getEmployeePayslips,
  updateSalaryStructure,
  deleteSalaryStructure,
};