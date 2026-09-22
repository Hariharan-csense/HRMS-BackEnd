const { salaryForMonth } = require("../services/salaryHistory");
const fs = require('fs');
const path = require('path');
const handlebars = require('handlebars');
const pdf = require('html-pdf');
const { sendEmailWithAttachment } = require('../utils/mailer'); // your SMTP module

const generatePdfFromHtml = (html, pdfPath) =>
  new Promise((resolve, reject) => {
    pdf.create(html, {
      format: 'A4',
      // Keep PhantomJS isolated from an incompatible host OpenSSL config.
      childProcessOptions: {
        env: {
          ...process.env,
          OPENSSL_CONF: process.platform === 'win32' ? 'NUL' : '/dev/null'
        }
      }
    }).toFile(pdfPath, (err, result) => {
      if (err) return reject(err);
      resolve(result);
    });
  });

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const roundTo2 = (value) => Number((Number(value) || 0).toFixed(2));

const calculatePercentageAmount = (base, percentage) => roundTo2((toNumber(base) * toNumber(percentage)) / 100);

const formatPayrollMonth = (month) => {
  const [year, monthNum] = String(month || '').split('-').map(Number);
  if (!year || !monthNum || monthNum < 1 || monthNum > 12) return month || '';

  return new Date(year, monthNum - 1, 1).toLocaleString('en-US', {
    month: 'long',
    year: 'numeric'
  });
};

const clampDayForMonth = (year, monthIndex, day) => {
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  return Math.min(lastDay, Math.max(1, Number(day) || 1));
};

const getPayrollPeriod = (month, company) => {
  const [year, monthNum] = String(month || '').split('-').map(Number);
  if (!year || !monthNum) return { startDate: null, endDate: null };

  const selectedMonthIndex = monthNum - 1;
  const startDay = Math.min(31, Math.max(1, Number(company?.payroll_start_day) || 1));
  const endDay = Math.min(31, Math.max(1, Number(company?.payroll_end_day) || 31));
  const startMonthIndex = startDay > endDay ? selectedMonthIndex - 1 : selectedMonthIndex;
  const endMonthIndex = selectedMonthIndex;
  return {
    startDate: new Date(year, startMonthIndex, clampDayForMonth(year, startMonthIndex, startDay)),
    endDate: new Date(year, endMonthIndex, clampDayForMonth(year, endMonthIndex, endDay))
  };
};

const formatDisplayDate = (date) => {
  if (!date) return '';
  return new Date(date).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
};

const formatPayrollPeriodLabel = (startDate, endDate) => {
  if (!startDate || !endDate) return '';
  return `${formatDisplayDate(startDate)} to ${formatDisplayDate(endDate)}`;
};

const numberToWords = (value) => {
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
  const teens = ['Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  const belowHundred = (num) => {
    if (num < 10) return ones[num];
    if (num < 20) return teens[num - 10];
    return `${tens[Math.floor(num / 10)]}${num % 10 ? ` ${ones[num % 10]}` : ''}`;
  };

  const belowThousand = (num) => {
    if (num < 100) return belowHundred(num);
    return `${ones[Math.floor(num / 100)]} Hundred${num % 100 ? ` ${belowHundred(num % 100)}` : ''}`;
  };

  const integerPart = Math.floor(Math.abs(Number(value) || 0));
  if (integerPart === 0) return 'Zero';

  const parts = [];
  const crore = Math.floor(integerPart / 10000000);
  const lakh = Math.floor((integerPart % 10000000) / 100000);
  const thousand = Math.floor((integerPart % 100000) / 1000);
  const rest = integerPart % 1000;

  if (crore) parts.push(`${belowThousand(crore)} Crore`);
  if (lakh) parts.push(`${belowThousand(lakh)} Lakh`);
  if (thousand) parts.push(`${belowThousand(thousand)} Thousand`);
  if (rest) parts.push(belowThousand(rest));

  return parts.join(' ');
};

const amountToWords = (value) => {
  const amount = Math.abs(Number(value) || 0);
  const rupees = Math.floor(amount);
  const paise = Math.round((amount - rupees) * 100);
  const rupeeWords = `${numberToWords(rupees)} Rupees`;
  const paiseWords = paise ? ` and ${numberToWords(paise)} Paise` : '';

  return `${rupeeWords}${paiseWords} Only`;
};

const getImageMimeType = (filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.webp') return 'image/webp';
  return 'image/jpeg';
};

const assetPathToBase64 = (assetPath) => {
  if (!assetPath) return null;
  if (String(assetPath).startsWith('http') || String(assetPath).startsWith('data:')) {
    return assetPath;
  }

  const relativePath = String(assetPath).replace(/^\/+/, '');
  const candidates = [
    path.resolve(__dirname, '..', '..', '..', relativePath),
    path.join(process.cwd(), '..', relativePath),
    path.join(process.cwd(), relativePath)
  ];
  const filePath = candidates.find((candidate) => fs.existsSync(candidate));

  if (!filePath) return null;

  return `data:${getImageMimeType(filePath)};base64,${fs.readFileSync(filePath).toString('base64')}`;
};

const sendPayslipEmail = async (companyId, employee, payrollData, knex) => {
  // Fetch company details
  const company = await knex('companies')
    .where({ id: companyId })
    .first();
  if (!company) throw new Error('Company not found');

  const structure = await salaryForMonth(knex, companyId, employee.id, payrollData.month, payrollData.salary_structure_snapshot);

  const department = employee?.department_id
    ? await knex('departments')
        .where({ id: employee.department_id, company_id: companyId })
        .first()
    : null;

  const designation = employee?.designation_id
    ? await knex('designations')
        .where({ id: employee.designation_id, company_id: companyId })
        .first()
    : null;

  const branch = employee?.branch_id
    ? await knex('branches')
        .where({ id: employee.branch_id, company_id: companyId })
        .first()
    : null;

  const bankDetails = await knex('employee_bank_details')
    .where({ employee_id: employee.id, company_id: companyId })
    .first();

  const componentGross = roundTo2(
    toNumber(structure?.basic) +
    toNumber(structure?.hra) +
    toNumber(structure?.lta) +
    toNumber(structure?.allowances) +
    toNumber(structure?.incentives)
  );
  const monthlyGross = roundTo2(toNumber(payrollData?.gross, componentGross));
  const tdsPercentage = toNumber(structure?.tds_percentage, toNumber(structure?.tds));
  const tdsAmount = toNumber(payrollData?.tds_amount, calculatePercentageAmount(monthlyGross, tdsPercentage));

  const monthlyDeductions = roundTo2(
    toNumber(payrollData?.deductions,
      toNumber(structure?.pf) +
      toNumber(structure?.esi) +
      toNumber(structure?.pt) +
      tdsAmount +
      toNumber(structure?.other_deductions)
    )
  );

  const monthlyNet = roundTo2(
    toNumber(
      payrollData?.net,
      monthlyGross - monthlyDeductions - toNumber(payrollData?.lop_amount) + toNumber(payrollData?.total_expenses)
    )
  );

  const annualGross = roundTo2(toNumber(payrollData?.annual_gross, monthlyGross * 12));
  const annualDeductions = roundTo2(toNumber(payrollData?.annual_deductions, monthlyDeductions * 12));
  const annualNet = roundTo2(toNumber(payrollData?.annual_net, monthlyNet * 12));
  const displayMonth = formatPayrollMonth(payrollData?.month);
  const { startDate, endDate } = getPayrollPeriod(payrollData?.month, company);

  const companyLogo = assetPathToBase64(company.logo_url || company.logo);
  const companySignature = assetPathToBase64(company.signature_url || company.signature);

  // Load Handlebars template
  const templatePath = path.join(__dirname, '..', 'templates', 'payslip.hbs');
  const templateHtml = fs.readFileSync(templatePath, 'utf-8');
  const template = handlebars.compile(templateHtml);

  // Prepare HTML content
  const html = template({
    ...payrollData,
    company_name: company.company_name || company.name || 'Company',
    company_logo: companyLogo, // URL or base64 image
    company_signature: companySignature,
    company_address: company.address,
    display_month: displayMonth,
    payroll_period: formatPayrollPeriodLabel(startDate, endDate),
    employee_code: employee.employee_id || '',
    employee_name: `${employee.first_name} ${employee.last_name || ''}`.trim(),
    department_name: department?.name || '-',
    designation_name: designation?.name || '-',
    branch_name: branch?.name || employee.location_office || '-',
    esi_number: employee.esic || '',
    uan_number: employee.uan || '',
    bank_name: bankDetails?.bank_name || '',
    account_no: bankDetails?.account_number || '',
    ifsc_code: bankDetails?.ifsc_code || '',
    basic: toNumber(structure?.basic),
    hra: toNumber(structure?.hra),
    lta: toNumber(structure?.lta),
    allowances: toNumber(structure?.allowances),
    incentives: toNumber(structure?.incentives),
    total_expenses: toNumber(payrollData?.total_expenses),
    pf: toNumber(structure?.pf),
    esi: toNumber(structure?.esi),
    pt: toNumber(structure?.pt),
    tds: tdsAmount,
    tds_percentage: tdsPercentage,
    other_deductions: toNumber(structure?.other_deductions),
    gross: monthlyGross,
    monthly_deductions: monthlyDeductions,
    monthly_net: monthlyNet,
    monthly_net_words: amountToWords(monthlyNet),
    annual_gross: annualGross,
    annual_deductions: annualDeductions,
    annual_net: annualNet,
    current_date: new Date().toISOString().slice(0, 10)
  });

  // Generate PDF using html-pdf
  const pdfDir = path.join(__dirname, 'temp');
  if (!fs.existsSync(pdfDir)) fs.mkdirSync(pdfDir, { recursive: true });
  const pdfPath = path.join(pdfDir, `payslip-${employee.id}-${payrollData.month}.pdf`);

  await generatePdfFromHtml(html, pdfPath);

  // Send email with PDF attachment
  await sendEmailWithAttachment(
    employee.email,
    `Payslip for ${displayMonth || payrollData.month}`,
    `Dear ${employee.first_name}, please find your payslip attached.`,
    pdfPath,
    `payslip-${payrollData.month}.pdf`
  );

  // Optional: delete PDF after sending
  fs.unlinkSync(pdfPath);
};

module.exports = { sendPayslipEmail };
