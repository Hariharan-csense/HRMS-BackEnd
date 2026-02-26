// src/controllers/payrollController.js
const knex = require('../db/db');
const fs = require('fs');
const path = require('path');
const handlebars = require('handlebars');
const pdf = require('html-pdf');
const { sendEmailWithAttachment } = require('../utils/mailer'); // SMTP module




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

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toBoolean = (value, fallback = false) => {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') return value.toLowerCase() === 'true' || value === '1';
  return fallback;
};

const calculateAmountFromPercentage = (base, percentage) => {
  return Number(((base * percentage) / 100).toFixed(2));
};

const roundTo2 = (value) => Number((Number(value) || 0).toFixed(2));

const normalizeAttendanceStatus = (status) => {
  const s = String(status || '').toLowerCase().trim();
  if (s === 'half-day' || s === 'half_day') return 'half';
  return s;
};

const generatePdfFromHtml = (html, pdfPath) => {
  return new Promise((resolve, reject) => {
    pdf
      .create(html, {
        format: 'A4',
        border: {
          top: '8mm',
          right: '8mm',
          bottom: '8mm',
          left: '8mm'
        }
      })
      .toFile(pdfPath, (err, result) => {
        if (err) return reject(err);
        resolve(result);
      });
  });
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
    pf_percentage,
    pf_enabled,
    esi = 0,
    esi_percentage,
    esi_enabled,
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

    const basicAmount = toNumber(basic);
    const pfEnabled = toBoolean(pf_enabled, toNumber(pf) > 0 || toNumber(pf_percentage) > 0);
    const esiEnabled = toBoolean(esi_enabled, toNumber(esi) > 0 || toNumber(esi_percentage) > 0);
    const pfPercentage = toNumber(pf_percentage);
    const esiPercentage = toNumber(esi_percentage);
    const hasPfPercentage = pf_percentage !== undefined && pf_percentage !== null && pf_percentage !== '';
    const hasEsiPercentage = esi_percentage !== undefined && esi_percentage !== null && esi_percentage !== '';
    const pfAmount = pfEnabled
      ? (hasPfPercentage ? calculateAmountFromPercentage(basicAmount, pfPercentage) : toNumber(pf))
      : 0;
    const esiAmount = esiEnabled
      ? (hasEsiPercentage ? calculateAmountFromPercentage(basicAmount, esiPercentage) : toNumber(esi))
      : 0;

    const gross = basicAmount + toNumber(hra) + toNumber(allowances) + toNumber(incentives);

    const existing = await knex('payroll_structures')
      .where({ employee_id: actualEmployeeId, company_id: companyId })
      .first();

    if (existing) {
      // UPDATE
      await knex('payroll_structures')
        .where({ employee_id: actualEmployeeId, company_id: companyId })
        .update({
          basic: basicAmount,
          hra: toNumber(hra),
          allowances: toNumber(allowances),
          incentives: toNumber(incentives),
          gross,
          pf: pfAmount,
          esi: esiAmount,
          pt: toNumber(pt),
          tds: toNumber(tds),
          other_deductions: toNumber(other_deductions)
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
        basic: basicAmount,
        hra: toNumber(hra),
        allowances: toNumber(allowances),
        incentives: toNumber(incentives),
        gross,
        pf: pfAmount,
        esi: esiAmount,
        pt: toNumber(pt),
        tds: toNumber(tds),
        other_deductions: toNumber(other_deductions)
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
    const attendanceRows = await knex('attendance')
      .where({
        employee_id: empId,
        company_id: companyId,
      })
      .andWhereRaw('MONTH(check_in) = ? AND YEAR(check_in) = ?', [monthNum, year])
      .select(
        knex.raw("DATE(check_in) as day"),
        'status',
        'hours_worked'
      );

    const presentDateSet = new Set();
    const halfDayDateSet = new Set();
    const attendanceCreditByDay = new Map();

    const holidayRows = await knex('holidays')
      .where({ company_id: companyId })
      .andWhereRaw('MONTH(date) = ? AND YEAR(date) = ?', [monthNum, year])
      .select(knex.raw("DATE_FORMAT(date, '%Y-%m-%d') as day"));

    const holidayDateSet = new Set(holidayRows.map((r) => r.day).filter(Boolean));

    const isWeekend = (d) => {
      const day = d.getDay();
      return day === 0 || day === 6;
    };

    const employeeShift = await knex('shifts')
      .where({ id: employee.shift_id, company_id: companyId })
      .first();

    const halfDayThresholdHours = Number(employeeShift?.half_day_threshold) > 0
      ? Number(employeeShift.half_day_threshold)
      : 4;
    let fullDayThresholdHours = 8;
    if (employeeShift?.start_time && employeeShift?.end_time) {
      const [sh, sm] = String(employeeShift.start_time).split(':').map(Number);
      const [eh, em] = String(employeeShift.end_time).split(':').map(Number);
      if (Number.isFinite(sh) && Number.isFinite(sm) && Number.isFinite(eh) && Number.isFinite(em)) {
        const start = new Date(2000, 0, 1, sh, sm, 0, 0);
        const end = new Date(2000, 0, 1, eh, em, 0, 0);
        if (end < start) end.setDate(end.getDate() + 1);
        const hours = (end - start) / (1000 * 60 * 60);
        if (hours > 0) fullDayThresholdHours = hours;
      }
    }

    for (const row of attendanceRows) {
      const dayKey = row.day instanceof Date ? row.day.toISOString().slice(0, 10) : String(row.day).slice(0, 10);
      if (!dayKey) continue;

      const dayObj = new Date(dayKey);
      if (isWeekend(dayObj) || holidayDateSet.has(dayKey)) continue;

      const status = normalizeAttendanceStatus(row.status);
      const hoursWorked = Number(row.hours_worked || 0);
      let credit = 0;

      if (status === 'absent') {
        credit = 0;
      } else if (status === 'half') {
        credit = 0.5;
      } else if (hoursWorked > 0) {
        if (hoursWorked >= halfDayThresholdHours && hoursWorked < fullDayThresholdHours) {
          credit = 0.5;
        } else if (hoursWorked >= fullDayThresholdHours) {
          credit = 1;
        } else {
          credit = 0;
        }
      } else if (status === 'present' || status === 'late') {
        credit = 1;
      }

      const existingCredit = attendanceCreditByDay.get(dayKey) || 0;
      if (credit > existingCredit) {
        attendanceCreditByDay.set(dayKey, credit);
      }
    }

    for (const [dayKey, credit] of attendanceCreditByDay.entries()) {
      if (credit >= 1) presentDateSet.add(dayKey);
      if (credit > 0 && credit < 1) halfDayDateSet.add(dayKey);
    }

    // ===============================
    // APPROVED LEAVES (PAID)
    // ===============================
    const approvedLeaves = await knex('leave_applications')
      .where({
        employee_id: empId,
        company_id: companyId,
        status: 'approved'
      })
      .andWhereRaw('from_date <= ? AND to_date >= ?', [endDate, startDate])
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

    const attendancePayableDays = Array.from(attendanceCreditByDay.values()).reduce((sum, c) => sum + c, 0);
    const leavePayableDays = Array.from(leaveDateSet.values()).reduce((sum, dayKey) => {
      return sum + (attendanceCreditByDay.has(dayKey) ? 0 : 1);
    }, 0);

    let payableDays = roundTo2(attendancePayableDays + leavePayableDays);
    if (payableDays > workingDays) payableDays = workingDays;

    let lopDays = roundTo2(workingDays - payableDays);
    if (lopDays < 0) lopDays = 0;

    let lopAmount = 0;
    if (lopDays > 0 && workingDays > 0) {
      const dailyGross = monthlyGross / workingDays;
      lopAmount = roundTo2(dailyGross * lopDays);
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
    monthlyNet = roundTo2(monthlyNet);

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
    const annualGross = roundTo2(monthlyGross * 12);
    const annualDeductions = roundTo2(monthlyDeductions * 12);
    const annualNet = roundTo2(monthlyNet * 12);

    // ===============================
    // SAVE PAYROLL
    // ===============================
    const payrollData = {
      employee_id: empId,
      company_id: companyId,
      month,
      total_days: totalDays,
      present_days: presentDateSet.size,
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
      present_days: presentDateSet.size,
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

    await generatePdfFromHtml(html, pdfPath);

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
          pf_enabled: Number(structure.pf || 0) > 0,
          pf_percentage: Number(structure.basic || 0) > 0
            ? Number(((Number(structure.pf || 0) / Number(structure.basic || 0)) * 100).toFixed(2))
            : 0,
          esi_enabled: Number(structure.esi || 0) > 0,
          esi_percentage: Number(structure.basic || 0) > 0
            ? Number(((Number(structure.esi || 0) / Number(structure.basic || 0)) * 100).toFixed(2))
            : 0,
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
    pf_percentage,
    pf_enabled,
    esi = 0,
    esi_percentage,
    esi_enabled,
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

    const basicAmount = toNumber(basic);
    const pfEnabled = toBoolean(pf_enabled, toNumber(pf) > 0 || toNumber(pf_percentage) > 0);
    const esiEnabled = toBoolean(esi_enabled, toNumber(esi) > 0 || toNumber(esi_percentage) > 0);
    const pfPercentage = toNumber(pf_percentage);
    const esiPercentage = toNumber(esi_percentage);
    const hasPfPercentage = pf_percentage !== undefined && pf_percentage !== null && pf_percentage !== '';
    const hasEsiPercentage = esi_percentage !== undefined && esi_percentage !== null && esi_percentage !== '';
    const pfAmount = pfEnabled
      ? (hasPfPercentage ? calculateAmountFromPercentage(basicAmount, pfPercentage) : toNumber(pf))
      : 0;
    const esiAmount = esiEnabled
      ? (hasEsiPercentage ? calculateAmountFromPercentage(basicAmount, esiPercentage) : toNumber(esi))
      : 0;

    const gross =
      basicAmount +
      toNumber(hra) +
      toNumber(allowances) +
      toNumber(incentives);

    await knex('payroll_structures')
      .where({ id, company_id: companyId })
      .update({
        basic: basicAmount,
        hra: toNumber(hra),
        allowances: toNumber(allowances),
        incentives: toNumber(incentives),
        gross,
        pf: pfAmount,
        esi: esiAmount,
        pt: toNumber(pt),
        tds: toNumber(tds),
        other_deductions: toNumber(other_deductions),
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
