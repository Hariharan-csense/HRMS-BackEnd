const {transporter} = require('./mailer');
const handlebars = require('handlebars');
const fs = require('fs');
const path = require('path');

const sendLeaveStatusNotification = async (application, employeeInfo, status) => {
  try {
    const templatePath = path.join(__dirname, '../templates/leaveNotification.hbs');
    const templateSource = fs.readFileSync(templatePath, 'utf8');
    const template = handlebars.compile(templateSource);

    const currentYear = new Date().getFullYear();

    const html = template({
      employeeName: employeeInfo.employee_name,
      employeeEmail: employeeInfo.employee_email,
      leaveType: application.leave_type_name || 'Leave',
      fromDate: new Date(application.from_date).toLocaleDateString('en-IN'),
      toDate: new Date(application.to_date).toLocaleDateString('en-IN'),
      days: application.days,
      reason: application.reason,
      status: status.charAt(0).toUpperCase() + status.slice(1),
      applicationId: application.application_id,
      baseUrl: process.env.BASE_URL || 'http://localhost:3000',
      currentYear
    });

    // 🔍 FULL DEBUG LOG
    console.log('📧 Sending Leave Status Notification');
    console.log('➡️ TO (Employee):', employeeInfo.employee_email);
    console.log('➡️ Status:', status);

    const info = await transporter.sendMail({
      from: `"HRMS System" <${process.env.EMAIL_FROM || process.env.EMAIL_USER}>`,
      to: employeeInfo.employee_email,
      subject: `Leave Request ${status.charAt(0).toUpperCase() + status.slice(1)} - ${employeeInfo.employee_name}`,
      html,
      attachments: application.attachment_path ? [{
        filename: path.basename(application.attachment_path),
        path: path.join(__dirname, '..', application.attachment_path)
      }] : []
    });

    // ✅ SMTP RESULT LOGS
    console.log('✅ Email sent successfully!');
    console.log('📬 Accepted by SMTP:', info.accepted);
    console.log('🚫 Rejected by SMTP:', info.rejected);
    console.log('🆔 Message ID:', info.messageId);

  } catch (error) {
    console.error('❌ Error sending leave status notification email:', error);
    throw error;
  }
};

module.exports = { sendLeaveStatusNotification };
