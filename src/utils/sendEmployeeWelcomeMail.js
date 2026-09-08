const { transporter } = require("./mailer");
const handlebars = require("handlebars");
const fs = require("fs");
const { resolveTemplatePath } = require("./templatePaths");

const sendEmployeeWelcomeMail = async (account) => {
  const templatePath = resolveTemplatePath("employeeWelcome.hbs");

  const template = handlebars.compile(fs.readFileSync(templatePath, "utf8"));
  const html = template({
    name: account.name,
    email: account.email,
    password: account.password,
    role: account.role || "Employee",
    companyName: account.companyName || "",
    loginUrl: process.env.FRONTEND_URL || process.env.CLIENT_URL || "https://hrms.procease.co/login",
    currentYear: new Date().getFullYear(),
  });

  const info = await transporter.sendMail({
    from: `"HRMS System" <${process.env.EMAIL_FROM || process.env.EMAIL_USER || process.env.SMTP_USER}>`,
    to: account.email,
    subject: "Your HRMS account and temporary password",
    text: [
      `Welcome, ${account.name}`,
      "Your HRMS account has been created.",
      `Email: ${account.email}`,
      `Temporary password: ${account.password}`,
      `Role: ${account.role || "Employee"}`,
      `Sign in: ${process.env.FRONTEND_URL || process.env.CLIENT_URL || "https://hrms.procease.co/login"}`,
      "Please change the temporary password immediately after signing in.",
    ].join("\n\n"),
    html,
  });
  if (!Array.isArray(info.accepted) || info.accepted.length === 0) {
    throw new Error("Mail server did not accept the welcome email recipient");
  }
  return info;
};

module.exports = { sendEmployeeWelcomeMail };
