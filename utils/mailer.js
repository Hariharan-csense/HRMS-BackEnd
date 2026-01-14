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

module.exports = { sendEmailWithAttachment, transporter };


