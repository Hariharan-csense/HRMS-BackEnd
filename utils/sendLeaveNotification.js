// src/utils/email.js
const transporter = require('./mailer'); // ← இப்போ transporter தனி file-ல இருந்து வருது
const handlebars = require('handlebars');
const fs = require('fs');
const path = require('path');

const sendLeaveNotification = async (toEmails, application, employeeInfo, leaveType) => {
  const templatePath = path.join(__dirname, '../templates/leaveNotification.hbs');
  const templateSource = fs.readFileSync(templatePath, 'utf8');
  const template = handlebars.compile(templateSource);

  const currentYear = new Date().getFullYear();

  const html = template({
    employeeName: employeeInfo.employee_name,
    employeeEmail: employeeInfo.employee_email,
    leaveType: leaveType.name,
    fromDate: new Date(application.from_date).toLocaleDateString('en-IN'),
    toDate: new Date(application.to_date).toLocaleDateString('en-IN'),
    days: application.days,
    reason: application.reason,
    status: application.status.charAt(0).toUpperCase() + application.status.slice(1),
    applicationId: application.application_id,
    baseUrl: process.env.BASE_URL || 'http://localhost:3000',
    currentYear
  });

  await transporter.sendMail({
    from: `"HRMS System" <${process.env.EMAIL_FROM || process.env.EMAIL_USER}>`,
    to: toEmails.join(', '),
    replyTo: employeeInfo.employee_email, // ← Manager reply பண்ணினா employee-க்கு direct போகும்
    subject: `New Leave Request - ${employeeInfo.employee_name} (${application.days} days)`,
    html,
    attachments: application.attachment_path ? [{
      filename: path.basename(application.attachment_path),
      path: path.join(__dirname, '..', application.attachment_path)
    }] : []
  });
};

module.exports = { sendLeaveNotification };