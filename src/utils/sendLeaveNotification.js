// src/utils/email.js
const { transporter } = require('../utils/mailer');
const handlebars = require('handlebars');
const fs = require('fs');
const path = require('path');
const { uploadRoot } = require('./uploadPaths');
const { resolveTemplatePath } = require('./templatePaths');


const sendLeaveNotification = async (toEmails, application, employeeInfo, leaveType) => {
  const templatePath = resolveTemplatePath('leaveNotification.hbs');
  const templateSource = fs.readFileSync(templatePath, 'utf8');
  const template = handlebars.compile(templateSource);

  const currentYear = new Date().getFullYear();
  const halfDaySessionLabel =
    application.half_day_session === 'first_half'
      ? 'First Half'
      : application.half_day_session === 'second_half'
        ? 'Second Half'
        : null;

  const html = template({
    employeeName: employeeInfo.employee_name,
    employeeEmail: employeeInfo.employee_email,
    leaveType: leaveType.name,
    fromDate: new Date(application.from_date).toLocaleDateString('en-IN'),
    toDate: new Date(application.to_date).toLocaleDateString('en-IN'),
    days: application.days,
    halfDaySessionLabel,
    reason: application.reason,
    status: application.status.charAt(0).toUpperCase() + application.status.slice(1),
    applicationId: application.application_id,
    baseUrl: process.env.BASE_URL || 'http://localhost:3000',
    currentYear
  });

  const attachmentPath = application.attachment_path
    ? path.join(
        uploadRoot,
        String(application.attachment_path).replace(/^\/?uploads\/?/, ''),
      )
    : null;

  await transporter.sendMail({
    from: `"HRMS System" <${process.env.EMAIL_FROM || process.env.EMAIL_USER}>`,
    to: toEmails.join(', '),
    replyTo: employeeInfo.employee_email, // ← Manager reply பண்ணினா employee-க்கு direct போகும்
    subject: `New Leave Request - ${employeeInfo.employee_name} (${application.days} days${halfDaySessionLabel ? `, ${halfDaySessionLabel}` : ''})`,
    html,
    attachments: attachmentPath ? [{
      filename: path.basename(application.attachment_path),
      path: attachmentPath
    }] : []
  });
};

module.exports = { sendLeaveNotification };
