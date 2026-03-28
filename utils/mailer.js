// src/utils/mailer.js
const nodemailer = require('nodemailer');

// Create transporter once (singleton)
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.EMAIL_PORT) || 587,
  secure: false, // true for 465, false for other ports
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  },
  tls: {
    rejectUnauthorized: false
  }
});

// Optional: Verify connection on startup
transporter.verify((error, success) => {
  if (error) {
    console.error('Email transporter error:', error);
  } else {
    console.log('✅ Email transporter ready!');
  }
});

const sendEmailWithAttachment = async (to, subject, text, attachmentPath, filename) => {
  return transporter.sendMail({
    from: `"HRMS" <${process.env.SMTP_USER}>`,
    to,
    subject,
    text,
    attachments: [{ filename, path: attachmentPath }]
  });
};

const sendEmail = async ({ to, subject, template, data }) => {
  // For now, just send a basic email without template processing
  // In a full implementation, you would integrate with a template engine
  let text = '';
  
  switch (template) {
    case 'settlement-created':
      text = `New F&F Settlement Created\n\nEmployee: ${data.employeeName}\nEmployee Code: ${data.employeeCode}\nResignation Date: ${data.resignationDate}\nLast Working Day: ${data.lastWorkingDay}\n\nPlease review and process settlement.`;
      break;
    case 'settlement-completed':
      text = `F&F Settlement Completed\n\nDear ${data.employeeName},\n\nYour Full & Final settlement has been processed.\n\nNet Amount: ${data.netAmount}\nPayment Mode: ${data.paymentMode}\nSettlement Date: ${data.settlementDate}\n\nThank you for your service.`;
      break;
    case 'settlement-update':
      text = `F&F Settlement Update\n\nDear ${data.employeeName},\n\nYour Full & Final settlement status has been updated.\n\nCurrent Status: ${data.status}\nNet Amount: ${data.netAmount}\nLast Working Day: ${data.lastWorkingDay}\nSettlement Date: ${data.settlementDate || 'Pending'}\n\nPlease contact HR for any queries.`;
      break;
    default:
      text = `HRMS Notification\n\n${JSON.stringify(data)}`;
  }
  
  return transporter.sendMail({
    from: `"HRMS" <${process.env.EMAIL_USER}>`,
    to,
    subject,
    text
  });
};

module.exports = { sendEmail, sendEmailWithAttachment, transporter };


