const { transporter } = require('./mailer'); // transporter = require('./mailer');
const handlebars = require('handlebars');
const fs = require('fs');
const path = require('path');

// 📩 Ticket Created → Superadmin Mail
const sendTicketCreatedMail = async (superAdminEmail, ticket, creator) => {
  try {
    const templatePath = path.join(__dirname, '../templates/ticketCreated.hbs');
    const templateSource = fs.readFileSync(templatePath, 'utf8');
    const template = handlebars.compile(templateSource);

    const currentYear = new Date().getFullYear();

    const html = template({
      ticketNumber: ticket.ticketNumber,
      title: ticket.title,
      description: ticket.description,
      priority: ticket.priority,
      category: ticket.category,
      raisedBy: creator.name,
      raisedEmail: creator.email,
      currentYear
    });

    console.log('📧 Sending Ticket Created Mail');
    console.log('➡️ TO (Superadmin):', superAdminEmail);

    const info = await transporter.sendMail({
      from: `"Ticket System" <${process.env.EMAIL_FROM || process.env.EMAIL_USER}>`,
      to: superAdminEmail,
      subject: `🎫 New Ticket Raised - ${ticket.ticketNumber}`,
      html
    });

    console.log('✅ Ticket Created Email Sent');
    console.log('📬 Accepted:', info.accepted);
    console.log('🚫 Rejected:', info.rejected);
    console.log('🆔 Message ID:', info.messageId);

  } catch (error) {
    console.error('❌ Error sending ticket created mail:', error);
    throw error;
  }
};


// 📩 Status Updated → Ticket Creator Mail
const sendTicketStatusUpdateMail = async (userEmail, ticket) => {
  try {
    const templatePath = path.join(__dirname, '../templates/ticketStatusUpdated.hbs');
    const templateSource = fs.readFileSync(templatePath, 'utf8');
    const template = handlebars.compile(templateSource);

    const currentYear = new Date().getFullYear();

    const html = template({
      ticketNumber: ticket.ticketNumber,
      title: ticket.title,
      status: ticket.status,
      remarks: ticket.remarks || 'No remarks provided',
      currentYear
    });

    console.log('📧 Sending Ticket Status Update Mail');
    console.log('➡️ TO (Ticket Creator):', userEmail);

    const info = await transporter.sendMail({
      from: `"Ticket System" <${process.env.EMAIL_FROM || process.env.EMAIL_USER}>`,
      to: userEmail,
      subject: `📢 Ticket Status Updated - ${ticket.ticketNumber}`,
      html
    });

    console.log('✅ Ticket Status Update Email Sent');
    console.log('📬 Accepted:', info.accepted);
    console.log('🚫 Rejected:', info.rejected);
    console.log('🆔 Message ID:', info.messageId);

  } catch (error) {
    console.error('❌ Error sending ticket status update mail:', error);
    throw error;
  }
};

module.exports = {
  sendTicketCreatedMail,
  sendTicketStatusUpdateMail
};
