const { transporter } = require('./mailer');
const handlebars = require('handlebars');
const fs = require('fs');
const path = require('path');

const sendEmployeeWelcomeMail = async (employee) => {
  try {

    const templatePath = path.join(
      __dirname,
      '../templates/employeeWelcome.hbs'
    );

    if (!fs.existsSync(templatePath)) {
      throw new Error('Employee mail template not found');
    }

    const templateSource = fs.readFileSync(templatePath, 'utf8');
    const template = handlebars.compile(templateSource);

    const html = template({
      name: employee.name,
      email: employee.email,
      password: employee.password, // ✅ ADD PASSWORD
      baseUrl: process.env.BASE_URL || 'http://localhost:3000',
      currentYear: new Date().getFullYear()
    });

    console.log('📧 Sending Employee Welcome Mail to:', employee.email);

    const info = await transporter.sendMail({
      from: `"HRMS System" <${process.env.EMAIL_FROM || process.env.EMAIL_USER}>`,
      to: employee.email,
      subject: 'Your HRMS Login Details 🔐',
      html
    });

    console.log('✅ Employee mail sent');
    console.log('📬 Accepted:', info.accepted);

  } catch (error) {
    console.error('❌ Employee welcome mail error:', error);
    throw error;
  }
};

module.exports = { sendEmployeeWelcomeMail };
