// src/utils/sendExpenseStatusNotification.js
const { transporter } = require('./mailer');
const handlebars = require('handlebars');
const fs = require('fs');
const path = require('path');

handlebars.registerHelper('eq', function (a, b) {
  return a === b;
});

handlebars.registerHelper('formatCurrency', function (value) {
  const amount = Number(value || 0);
  return amount.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
});

const sendExpenseStatusNotification = async (expenses, employeeInfo, status) => {
  try {
    const expenseList = Array.isArray(expenses) ? expenses.filter(Boolean) : [expenses].filter(Boolean);
    if (!expenseList.length) {
      return;
    }

    const templatePath = path.join(__dirname, '../templates/expenseStatusNotification.hbs');
    const templateSource = fs.readFileSync(templatePath, 'utf8');
    const template = handlebars.compile(templateSource);

    const primaryExpense = expenseList[0];
    const normalizedStatus = `${status.charAt(0).toUpperCase()}${status.slice(1)}`;
    const expenseDate = primaryExpense.expense_date
      ? new Date(primaryExpense.expense_date).toLocaleDateString('en-IN')
      : null;
    const approvedAt = primaryExpense.approved_at
      ? new Date(primaryExpense.approved_at).toLocaleDateString('en-IN')
      : null;
    const totalAmount = expenseList.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
    const currentYear = new Date().getFullYear();

    const html = template({
      employeeName: employeeInfo.employee_name,
      expenseId: primaryExpense.expense_id,
      expenseDate,
      amount: primaryExpense.amount,
      category: primaryExpense.category || '',
      description: primaryExpense.description || '',
      status: normalizedStatus,
      approvedAt,
      expenseCount: expenseList.length,
      totalAmount: totalAmount.toLocaleString('en-IN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
      isSummary: expenseList.length > 1,
      expenses: expenseList.map((expense) => ({
        expense_id: expense.expense_id,
        category: expense.category || '',
        description: expense.description || '',
        amount: Number(expense.amount || 0),
      })),
      baseUrl: process.env.BASE_URL || 'http://localhost:3000',
      currentYear,
    });

    console.log('Sending Expense Status Notification');
    console.log('TO (Employee):', employeeInfo.employee_email);
    console.log('Status:', status);

    const info = await transporter.sendMail({
      from: `"HRMS System" <${process.env.EMAIL_FROM || process.env.EMAIL_USER}>`,
      to: employeeInfo.employee_email,
      subject: expenseList.length > 1
        ? `${expenseList.length} Expenses ${normalizedStatus}${expenseDate ? ` - ${expenseDate}` : ''}`
        : `Expense ${normalizedStatus} - ${primaryExpense.expense_id}`,
      html,
    });

    console.log('Expense Status email sent successfully!');
    console.log('Accepted by SMTP:', info.accepted);
    console.log('Rejected by SMTP:', info.rejected);
    console.log('Message ID:', info.messageId);
  } catch (error) {
    console.error('Error sending expense status notification email:', error);
    throw error;
  }
};

module.exports = { sendExpenseStatusNotification };
