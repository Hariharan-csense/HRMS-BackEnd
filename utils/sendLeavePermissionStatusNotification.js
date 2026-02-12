// src/utils/sendLeavePermissionStatusNotification.js
const { transporter } = require('../utils/mailer');
const handlebars = require('handlebars');
const fs = require('fs');
const path = require('path');

const sendLeavePermissionStatusNotification = async (permission, employeeInfo, status) => {
  try {
    const templatePath = path.join(__dirname, '../templates/leavePermissionStatusNotification.hbs');
    const templateSource = fs.readFileSync(templatePath, 'utf8');
    const template = handlebars.compile(templateSource);

    const currentYear = new Date().getFullYear();

    const html = template({
      employeeName: employeeInfo.employee_name,
      permissionDate: new Date(permission.permission_date).toLocaleDateString('en-IN'),
      permissionTimeFrom: permission.permission_time_from,
      permissionTimeTo: permission.permission_time_to,
      reason: permission.reason,
      status: status.charAt(0).toUpperCase() + status.slice(1),
      permissionId: permission.permission_id,
      remarks: permission.remarks,
      approvedAt: permission.approved_at ? new Date(permission.approved_at).toLocaleDateString('en-IN') : null,
      baseUrl: process.env.BASE_URL || 'http://localhost:3000',
      currentYear
    });

    // 🔍 DEBUG LOG
    console.log('📧 Sending Leave Permission Status Notification');
    console.log('➡️ TO (Employee):', employeeInfo.employee_email);
    console.log('➡️ Status:', status);

    const info = await transporter.sendMail({
      from: `"HRMS System" <${process.env.EMAIL_FROM || process.env.EMAIL_USER}>`,
      to: employeeInfo.employee_email,
      subject: `Leave Permission ${status.charAt(0).toUpperCase() + status.slice(1)} - ${permission.permission_id}`,
      html
    });

    // ✅ SMTP RESULT LOGS
    console.log('✅ Leave Permission Status email sent successfully!');
    console.log('📬 Accepted by SMTP:', info.accepted);
    console.log('🚫 Rejected by SMTP:', info.rejected);
    console.log('🆔 Message ID:', info.messageId);

  } catch (error) {
    console.error('❌ Error sending leave permission status notification email:', error);
    throw error;
  }
};

module.exports = { sendLeavePermissionStatusNotification };
