const knex = require('./db/db');

async function seedTemplates() {
  try {
    // Check if table exists
    const tableExists = await knex.schema.hasTable('offer_templates');
    console.log('Table exists:', tableExists);
    
    if (tableExists) {
      // Get company_id from companies table
      const company = await knex('companies').first();
      console.log('Company:', company);
      
      if (company) {
        // Get user for created_by
        const user = await knex('users').first();
        console.log('User:', user);
        
        // Insert sample templates
        const templates = [
          {
            company_id: company.company_id,
            name: 'Standard Offer',
            content: `Dear {{candidateName}},

We are pleased to offer you the position of {{position}} at {{companyName}}.

Position Details:
- Department: {{department}}
- Location: {{location}}
- Employment Type: {{employmentType}}
- Start Date: {{startDate}}
- Salary: {{salary}}

We believe your skills and experience will be valuable to our team. Please review this offer and let us know your decision within {{responseTime}} days.

Best regards,
{{companyName}} HR Team`,
            variables: JSON.stringify(['candidateName', 'position', 'companyName', 'department', 'location', 'employmentType', 'startDate', 'salary', 'responseTime']),
            is_default: true,
            is_active: true,
            created_by: user ? user.id : null
          },
          {
            company_id: company.company_id,
            name: 'Senior Management Offer',
            content: `Dear {{candidateName}},

It is with great pleasure that we extend this offer for the position of {{position}} at {{companyName}}.

Executive Summary:
- Leadership Role: {{position}}
- Department: {{department}}
- Location: {{location}}
- Employment Type: {{employmentType}}
- Start Date: {{startDate}}
- Compensation Package: {{salary}}
- Additional Benefits: {{benefits}}

Your extensive experience in {{experienceArea}} makes you an ideal candidate for this leadership position. We are excited about the prospect of you joining our executive team.

Please confirm your acceptance of this offer within {{responseTime}} days.

Sincerely,
{{companyName}} Leadership`,
            variables: JSON.stringify(['candidateName', 'position', 'companyName', 'department', 'location', 'employmentType', 'startDate', 'salary', 'benefits', 'experienceArea', 'responseTime']),
            is_default: false,
            is_active: true,
            created_by: user ? user.id : null
          }
        ];

        await knex('offer_templates').insert(templates);
        console.log('Sample templates inserted successfully');
        
        // Show inserted templates
        const insertedTemplates = await knex('offer_templates').select('*');
        console.log('Templates:', insertedTemplates);
      }
    }
    
  } catch (error) {
    console.error('Error seeding templates:', error);
  } finally {
    await knex.destroy();
  }
}

seedTemplates();
