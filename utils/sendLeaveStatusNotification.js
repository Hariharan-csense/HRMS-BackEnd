const transporter = require('./mailer'); // transporter from separate file
const handlebars = require('handlebars');
const fs = require('fs');
const path = require('path');

/**
 * Send leave status notification (approved/rejected) to employee
 * @param {object} application - Leave application object
 * @param {object} employeeInfo - { employee_name, employee_email }
 * @param {string} status - 'approved' or 'rejected'
 */
const sendLeaveStatusNotification = async (application, employeeInfo, status) => {
  try {
    const templatePath = path.join(__dirname, '../templates/leave-status.hbs');
    const templateSource = fs.readFileSync(templatePath, 'utf8');
    const template = handlebars.compile(templateSource);

    const currentYear = new Date().getFullYear();

    const html = template({
      employeeName: employeeInfo.employee_name,
      leaveType: application.leave_type_name,
      fromDate: new Date(application.from_date).toLocaleDateString('en-IN'),
      toDate: new Date(application.to_date).toLocaleDateString('en-IN'),
      days: application.days,
      remarks: application.remarks || '',
      status: status.charAt(0).toUpperCase() + status.slice(1),
      applicationId: application.application_id,
      baseUrl: process.env.BASE_URL || 'http://localhost:3000',
      currentYear,
      isApproved: status.toLowerCase() === 'approved' // ← ensures template renders correctly
    });

    await transporter.sendMail({
      from: `"HRMS System" <${process.env.EMAIL_FROM || process.env.SMTP_USER}>`,
      to: employeeInfo.employee_email,
      subject: `Leave ${status.toUpperCase()} - ${employeeInfo.employee_name} (${application.days} days)`,
      html
    });

    console.log(`Leave status email sent to ${employeeInfo.employee_email}`);
  } catch (error) {
    console.error('Error sending leave status email:', error);
  }
};

module.exports = { sendLeaveStatusNotification };
