const { transporter } = require('./mailer');
const handlebars = require('handlebars');
const fs = require('fs');
const path = require('path');

const sendOfferLetterEmail = async (offerLetter) => {
  try {
    const templatePath = path.join(
      __dirname,
      '../templates/offerLetterEmail.hbs'
    );

    // If template doesn't exist, send plain text email
    let html;
    if (fs.existsSync(templatePath)) {
      const templateSource = fs.readFileSync(templatePath, 'utf8');
      const template = handlebars.compile(templateSource);
      
      html = template({
        candidateName: offerLetter.candidate_name,
        position: offerLetter.position,
        department: offerLetter.department,
        salary: offerLetter.salary,
        startDate: new Date(offerLetter.start_date).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        }),
        location: offerLetter.location,
        employmentType: offerLetter.employment_type,
        companyName: 'Your Company', // You might want to get this from company table
        offerContent: offerLetter.offer_content,
        currentYear: new Date().getFullYear()
      });
    } else {
      // Fallback to plain HTML if template doesn't exist
      html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #333;">Offer Letter - ${offerLetter.position}</h2>
          <p>Dear <strong>${offerLetter.candidate_name}</strong>,</p>
          <p>We are pleased to extend an offer of employment for the position of <strong>${offerLetter.position}</strong> at Your Company.</p>
          
          <div style="background-color: #f5f5f5; padding: 15px; margin: 20px 0; border-radius: 5px;">
            <h3 style="color: #333; margin-top: 0;">Position Details:</h3>
            <ul style="line-height: 1.6;">
              <li><strong>Designation:</strong> ${offerLetter.position}</li>
              <li><strong>Department:</strong> ${offerLetter.department}</li>
              <li><strong>Location:</strong> ${offerLetter.location}</li>
              <li><strong>Employment Type:</strong> ${offerLetter.employment_type}</li>
              <li><strong>Date of Joining:</strong> ${new Date(offerLetter.start_date).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
              })}</li>
              <li><strong>Salary:</strong> ${offerLetter.salary}</li>
            </ul>
          </div>
          
          <div style="margin: 20px 0;">
            <h3 style="color: #333;">Offer Letter Content:</h3>
            <div style="background-color: #fafafa; padding: 20px; border-left: 4px solid #007bff; white-space: pre-wrap;">
              ${offerLetter.offer_content}
            </div>
          </div>
          
          <p>If you have any questions or require further clarification, feel free to contact HR Team.</p>
          
          <p>We believe that your skills and experience will contribute significantly to our team, and we look forward to the positive impact you will make to the organization.</p>
          
          <p>Once again, congratulations on your appointment to this vital role at Your Company.</p>
          
          <p>Best regards,<br>
          HR Team<br>
          Your Company</p>
          
          <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;">
          
          <p style="font-size: 12px; color: #666;">This is a system-generated email. Please do not reply to this email.</p>
        </div>
      `;
    }

    console.log('📧 Sending Offer Letter to:', offerLetter.candidate_email);

    const info = await transporter.sendMail({
      from: `"HRMS System" <${process.env.EMAIL_FROM || process.env.EMAIL_USER}>`,
      to: offerLetter.candidate_email,
      subject: `Offer Letter - ${offerLetter.position} at Your Company`,
      html
    });

    console.log('✅ Offer letter email sent successfully');
    console.log('📬 Message ID:', info.messageId);
    console.log('📬 Accepted:', info.accepted);

    return {
      success: true,
      messageId: info.messageId,
      accepted: info.accepted
    };

  } catch (error) {
    console.error('❌ Offer letter email error:', error);
    throw error;
  }
};

module.exports = { sendOfferLetterEmail };
