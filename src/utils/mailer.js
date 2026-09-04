// src/utils/mailer.js
const nodemailer = require("nodemailer");
const handlebars = require("handlebars");
const fs = require("fs");
const path = require("path");

const emailUser = process.env.EMAIL_USER || process.env.SMTP_USER;
const emailPass = process.env.EMAIL_PASS || process.env.SMTP_PASS;
const emailHost = process.env.EMAIL_HOST || process.env.SMTP_HOST || "smtp.gmail.com";
const parsedEmailPort = Number.parseInt(
  String(process.env.EMAIL_PORT || process.env.SMTP_PORT || "587").trim(),
  10,
);
const emailPort = Number.isFinite(parsedEmailPort) ? parsedEmailPort : 587;
const emailFrom = process.env.EMAIL_FROM || emailUser;

// Create transporter once (singleton)
const transporter = nodemailer.createTransport({
  host: emailHost,
  port: emailPort,
  secure: emailPort === 465,
  auth: {
    user: emailUser,
    pass: emailPass,
  },
  tls: {
    rejectUnauthorized: false,
  },
});

// Optional: Verify connection on startup
transporter.verify((error, success) => {
  if (error) {
    console.error("Email transporter error:", error);
  } else {
    // console.log('✅ Email transporter ready!');
  }
});

const sendEmailWithAttachment = async (
  to,
  subject,
  text,
  attachmentPath,
  filename,
) => {
  return transporter.sendMail({
    from: `"HRMS" <${emailFrom}>`,
    to,
    subject,
    text,
    attachments: [{ filename, path: attachmentPath }],
  });
};

const sendEmail = async ({ to, subject, template, data }) => {
  let text = "";
  let html = "";

  const formatDate = (value) => {
    if (!value) return "Pending";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  };

  const formatAmount = (value) => {
    const amount = Number(value || 0);
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 2,
    }).format(amount);
  };

  const humanize = (value) =>
    String(value || "Pending")
      .replace(/_/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase());

  const renderTemplate = (templateFile, templateData) => {
    const templatePath = path.join(__dirname, "..", "templates", templateFile);
    const templateSource = fs.readFileSync(templatePath, "utf8");
    const compiledTemplate = handlebars.compile(templateSource);
    return compiledTemplate(templateData);
  };

  switch (template) {
    case "settlement-created":
      text = `New F&F Settlement Created\n\nEmployee: ${data.employeeName}\nEmployee Code: ${data.employeeCode}\nResignation Date: ${data.resignationDate}\nLast Working Day: ${data.lastWorkingDay}\n\nPlease review and process settlement.`;
      html = renderTemplate("settlementCreated.hbs", {
        title: "F&F Settlement Created",
        greeting: "Settlement workflow is now ready for review.",
        intro: `A new full and final settlement has been created for ${data.employeeName}.`,
        rows: [
          { label: "Employee", value: data.employeeName },
          { label: "Employee Code", value: data.employeeCode },
          {
            label: "Resignation Date",
            value: formatDate(data.resignationDate),
          },
          { label: "Last Working Day", value: formatDate(data.lastWorkingDay) },
        ],
        outro:
          "Please review the settlement and complete the next action in HRMS.",
      });
      break;
    case "settlement-completed":
      text = `F&F Settlement Completed\n\nDear ${data.employeeName},\n\nYour Full & Final settlement has been processed.\n\nNet Amount: ${data.netAmount}\nPayment Mode: ${data.paymentMode}\nSettlement Date: ${data.settlementDate}\n\nThank you for your service.`;
      html = renderTemplate("settlementCompleted.hbs", {
        title: "F&F Settlement Completed",
        greeting: `Dear ${data.employeeName},`,
        intro:
          "Your full and final settlement has been completed successfully.",
        rows: [
          { label: "Net Amount", value: formatAmount(data.netAmount) },
          { label: "Payment Mode", value: humanize(data.paymentMode) },
          { label: "Settlement Date", value: formatDate(data.settlementDate) },
        ],
        outro:
          "Thank you for your contribution. Please reach out to HR if you need any clarification.",
      });
      break;
    case "settlement-update":
      text = `F&F Settlement Update\n\nDear ${data.employeeName},\n\nYour Full & Final settlement status has been updated.\n\nCurrent Status: ${data.status}\nNet Amount: ${data.netAmount}\nLast Working Day: ${data.lastWorkingDay}\nSettlement Date: ${data.settlementDate || "Pending"}\n\nPlease contact HR for any queries.`;
      html = renderTemplate("settlementUpdate.hbs", {
        title: "F&F Settlement Update",
        greeting: `Dear ${data.employeeName},`,
        intro: "Your full and final settlement has been updated.",
        rows: [
          { label: "Current Status", value: humanize(data.status) },
          { label: "Net Amount", value: formatAmount(data.netAmount) },
          { label: "Last Working Day", value: formatDate(data.lastWorkingDay) },
          { label: "Settlement Date", value: formatDate(data.settlementDate) },
        ],
      });
      break;
    default:
      text = `HRMS Notification\n\n${JSON.stringify(data)}`;
      html = `<pre style="font-family:Segoe UI,Arial,sans-serif;">${JSON.stringify(data, null, 2)}</pre>`;
  }

  return transporter.sendMail({
    from: `"HRMS" <${emailFrom}>`,
    to,
    subject,
    text,
    html,
  });
};

module.exports = { sendEmail, sendEmailWithAttachment, transporter };
