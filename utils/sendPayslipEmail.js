const fs = require('fs');
const path = require('path');
const handlebars = require('handlebars');
const pdf = require('html-pdf');
const { sendEmailWithAttachment } = require('../utils/mailer'); // your SMTP module

const generatePdfFromHtml = (html, pdfPath) =>
  new Promise((resolve, reject) => {
    pdf.create(html, { format: 'A4' }).toFile(pdfPath, (err, result) => {
      if (err) return reject(err);
      resolve(result);
    });
  });

const sendPayslipEmail = async (companyId, employee, payrollData, knex) => {
  // Fetch company details
  const company = await knex('company')
    .where({ id: companyId })
    .first();
  if (!company) throw new Error('Company not found');

  // Load Handlebars template
 const templatePath = path.join(__dirname, '..', 'templates', 'payslip.hbs');
  const templateHtml = fs.readFileSync(templatePath, 'utf-8');
  const template = handlebars.compile(templateHtml);

  // Prepare HTML content
  const html = template({
    ...payrollData,
    company_name: company.name,
    company_logo: company.logo_url, // URL or base64 image
    company_address: company.address,
    employee_name: `${employee.first_name} ${employee.last_name || ''}`
  });

  // Generate PDF using html-pdf
  const pdfDir = path.join(__dirname, 'temp');
  if (!fs.existsSync(pdfDir)) fs.mkdirSync(pdfDir, { recursive: true });
  const pdfPath = path.join(pdfDir, `payslip-${employee.id}-${payrollData.month}.pdf`);

  await generatePdfFromHtml(html, pdfPath);

  // Send email with PDF attachment
  await sendEmailWithAttachment(
    employee.email,
    `Payslip for ${payrollData.month}`,
    `Dear ${employee.first_name}, please find your payslip attached.`,
    pdfPath,
    `payslip-${payrollData.month}.pdf`
  );

  // Optional: delete PDF after sending
  fs.unlinkSync(pdfPath);
};

module.exports = { sendPayslipEmail };
