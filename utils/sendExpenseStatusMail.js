// src/utils/sendExpenseStatusNotification.js
const { transporter } = require('./mailer');
const handlebars = require('handlebars');
const fs = require('fs');
const path = require('path');

handlebars.registerHelper('eq', function (a, b) {
  return a === b;
});


const sendExpenseStatusNotification = async (expense, employeeInfo, status) => {
  try {
    const templatePath = path.join(__dirname, '../templates/expenseStatusNotification.hbs');
    const templateSource = fs.readFileSync(templatePath, 'utf8');
    const template = handlebars.compile(templateSource);

    const currentYear = new Date().getFullYear();

    const html = template({
      employeeName: employeeInfo.employee_name,
      expenseId: expense.expense_id,
      expenseDate: expense.expense_date
        ? new Date(expense.expense_date).toLocaleDateString('en-IN')
        : null,
      amount: expense.amount,
      category: expense.category || '',
      description: expense.description || '',
      status: status.charAt(0).toUpperCase() + status.slice(1),
      remarks: expense.remarks || '',
      approvedAt: expense.approved_at
        ? new Date(expense.approved_at).toLocaleDateString('en-IN')
        : null,
      baseUrl: process.env.BASE_URL || 'http://localhost:3000',
      currentYear
    });

    // 🔍 DEBUG LOG
    console.log('📧 Sending Expense Status Notification');
    console.log('➡️ TO (Employee):', employeeInfo.employee_email);
    console.log('➡️ Status:', status);

    const info = await transporter.sendMail({
      from: `"HRMS System" <${process.env.EMAIL_FROM || process.env.EMAIL_USER}>`,
      to: employeeInfo.employee_email,
      subject: `Expense ${status.charAt(0).toUpperCase() + status.slice(1)} - ${expense.expense_id}`,
      html
    });

    // ✅ SMTP RESULT LOGS
    console.log('✅ Expense Status email sent successfully!');
    console.log('📬 Accepted by SMTP:', info.accepted);
    console.log('🚫 Rejected by SMTP:', info.rejected);
    console.log('🆔 Message ID:', info.messageId);

  } catch (error) {
    console.error('❌ Error sending expense status notification email:', error);
    throw error;
  }
};

module.exports = { sendExpenseStatusNotification };
