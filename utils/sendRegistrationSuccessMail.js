const { transporter } = require('./mailer');
const handlebars = require('handlebars');
const fs = require('fs');
const path = require('path');

const sendRegistrationSuccessMail = async (user, companyName = null) => {
  try {

    const templatePath = path.join(
      __dirname,
      '../templates/registrationSuccess.hbs'
    );

    const templateSource = fs.readFileSync(templatePath, 'utf8');
    const template = handlebars.compile(templateSource);

    const currentYear = new Date().getFullYear();

    const html = template({
      name: user.name,
      email: user.email,
      role: user.role,
      companyName: companyName || '',
      baseUrl: process.env.BASE_URL || 'http://localhost:3000',
      currentYear
    });

    // 🔍 DEBUG LOG
    console.log('📧 Sending Registration Success Email');
    console.log('➡️ TO:', user.email);

    const info = await transporter.sendMail({
      from: `"HRMS System" <${process.env.EMAIL_FROM || process.env.EMAIL_USER}>`,
      to: user.email,
      subject: '🎉 Registration Successful - Welcome to HRMS',
      html
    });

    // ✅ SMTP RESULT LOGS
    console.log('✅ Registration email sent successfully!');
    console.log('📬 Accepted by SMTP:', info.accepted);
    console.log('🚫 Rejected by SMTP:', info.rejected);
    console.log('🆔 Message ID:', info.messageId);

  } catch (error) {
    console.error('❌ Error sending registration success email:', error);
    throw error;
  }
};

module.exports = { sendRegistrationSuccessMail };
