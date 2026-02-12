const knex = require('../db/db');
const { sendOfferLetterEmail } = require('../utils/sendOfferLetterEmail');

// Get all offer letters for a company
const getOfferLetters = async (req, res) => {
  try {
    const companyId = req.user.company_id;
    const { status, search } = req.query;

    let query = knex('offer_letters')
      .where('company_id', companyId)
      .orderBy('created_at', 'desc');

    // Apply filters
    if (status && status !== 'all') {
      query = query.where('status', status);
    }

    if (search) {
      query = query.where(function() {
        this.where('candidate_name', 'ilike', `%${search}%`)
            .orWhere('candidate_email', 'ilike', `%${search}%`)
            .orWhere('position', 'ilike', `%${search}%`);
      });
    }

    const offerLetters = await query;

    res.json({
      success: true,
      data: offerLetters
    });
  } catch (error) {
    console.error('Error fetching offer letters:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch offer letters'
    });
  }
};

// Get offer letter by ID
const getOfferLetterById = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user.company_id;

    const offerLetter = await knex('offer_letters')
      .where({
        id,
        company_id: companyId
      })
      .first();

    if (!offerLetter) {
      return res.status(404).json({
        success: false,
        message: 'Offer letter not found'
      });
    }

    res.json({
      success: true,
      data: offerLetter
    });
  } catch (error) {
    console.error('Error fetching offer letter:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch offer letter'
    });
  }
};

// Create new offer letter
const createOfferLetter = async (req, res) => {
  try {
    console.log('=== CREATE OFFER LETTER DEBUG ===');
    console.log('Request body:', req.body);
    console.log('User:', req.user);
    console.log('Company ID:', req.user?.company_id);
    
    const companyId = req.user.company_id;
    const {
      candidate_id,
      candidate_name,
      candidate_email,
      position,
      department,
      salary,
      start_date,
      location,
      employment_type,
      template,
      custom_terms
    } = req.body;

    console.log('Extracted data:', {
      companyId,
      candidate_id,
      candidate_name,
      candidate_email,
      position,
      department,
      salary,
      start_date,
      location,
      employment_type,
      template,
      custom_terms
    });

    // Validate required fields
    if (!candidate_name || !candidate_email) {
      console.log('ERROR: Missing required candidate fields');
      return res.status(400).json({
        success: false,
        message: 'Candidate name and email are required'
      });
    }

    // Handle candidate_id - if it's empty or null, set it to null for the database
    const candidateIdValue = candidate_id && candidate_id.trim() !== '' ? candidate_id : null;

    console.log('Final candidate_id value:', candidateIdValue);

    // Get template content
    const offerTemplate = await knex('offer_templates')
      .where({
        company_id: companyId,
        name: template,
        is_active: true
      })
      .first();

    if (!offerTemplate) {
      return res.status(400).json({
        success: false,
        message: 'Offer template not found'
      });
    }

    // Generate offer content by replacing template variables
    let offerContent = offerTemplate.content;
    const replacements = {
      '{{candidateName}}': candidate_name,
      '{{position}}': position,
      '{{department}}': department,
      '{{location}}': location,
      '{{employmentType}}': employment_type,
      '{{startDate}}': start_date,
      '{{salary}}': salary,
      '{{companyName}}': 'Your Company', // You might want to get this from company table
      '{{responseTime}}': '7'
    };

    Object.keys(replacements).forEach(key => {
      offerContent = offerContent.replace(new RegExp(key, 'g'), replacements[key]);
    });

    const insertResult = await knex('offer_letters').insert({
      company_id: companyId,
      candidate_id: candidateIdValue,
      candidate_name,
      candidate_email,
      position,
      department,
      salary,
      start_date,
      location,
      employment_type,
      template,
      custom_terms,
      offer_content: offerContent,
      created_by: req.user.id
    });

    // Get the inserted record (returning() doesn't work well with MySQL)
    const offerLetter = await knex('offer_letters')
      .where('id', insertResult[0])
      .first();

    console.log('Created offer letter:', offerLetter);

    res.status(201).json({
      success: true,
      data: offerLetter,
      message: 'Offer letter created successfully'
    });
  } catch (error) {
    console.error('Error creating offer letter:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create offer letter'
    });
  }
};

// Update offer letter
const updateOfferLetter = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user.company_id;
    const updateData = { ...req.body, updated_by: req.user.id };

    // Check if offer letter exists and belongs to company
    const existingOffer = await knex('offer_letters')
      .where({ id, company_id: companyId })
      .first();

    if (!existingOffer) {
      return res.status(404).json({
        success: false,
        message: 'Offer letter not found'
      });
    }

    // If template or other fields changed, regenerate content
    if (updateData.template || updateData.candidate_name || updateData.position || 
        updateData.department || updateData.location || updateData.employment_type || 
        updateData.start_date || updateData.salary) {
      
      const template = updateData.template || existingOffer.template;
      const offerTemplate = await knex('offer_templates')
        .where({
          company_id: companyId,
          name: template,
          is_active: true
        })
        .first();

      if (offerTemplate) {
        let offerContent = offerTemplate.content;
        const replacements = {
          '{{candidateName}}': updateData.candidate_name || existingOffer.candidate_name,
          '{{position}}': updateData.position || existingOffer.position,
          '{{department}}': updateData.department || existingOffer.department,
          '{{location}}': updateData.location || existingOffer.location,
          '{{employmentType}}': updateData.employment_type || existingOffer.employment_type,
          '{{startDate}}': updateData.start_date || existingOffer.start_date,
          '{{salary}}': updateData.salary || existingOffer.salary,
          '{{companyName}}': 'Your Company',
          '{{responseTime}}': '7'
        };

        Object.keys(replacements).forEach(key => {
          offerContent = offerContent.replace(new RegExp(key, 'g'), replacements[key]);
        });

        updateData.offer_content = offerContent;
      }
    }

    const updateResult = await knex('offer_letters')
      .where({ id, company_id: companyId })
      .update(updateData);

    // Get the updated record (returning() doesn't work well with MySQL)
    const updatedOffer = await knex('offer_letters')
      .where('id', id)
      .first();

    console.log('Updated offer letter:', updatedOffer);

    res.json({
      success: true,
      data: updatedOffer,
      message: 'Offer letter updated successfully'
    });
  } catch (error) {
    console.error('Error updating offer letter:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update offer letter'
    });
  }
};

// Delete offer letter
const deleteOfferLetter = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user.company_id;

    const deleted = await knex('offer_letters')
      .where({ id, company_id: companyId })
      .del();

    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: 'Offer letter not found'
      });
    }

    res.json({
      success: true,
      message: 'Offer letter deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting offer letter:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete offer letter'
    });
  }
};

// Send offer letter
const sendOfferLetter = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user.company_id;

    // First update the offer letter status
    const updateResult = await knex('offer_letters')
      .where({ id, company_id: companyId })
      .update({
        status: 'sent',
        sent_date: new Date(),
        updated_by: req.user.id
      });

    if (updateResult === 0) {
      return res.status(404).json({
        success: false,
        message: 'Offer letter not found'
      });
    }

    // Then fetch the updated record
    const updatedOffer = await knex('offer_letters')
      .where({ id, company_id: companyId })
      .first();

    if (!updatedOffer) {
      return res.status(404).json({
        success: false,
        message: 'Offer letter not found after update'
      });
    }

    // Send email to candidate
    try {
      console.log('📧 Attempting to send offer letter email to:', updatedOffer.candidate_email);
      const emailResult = await sendOfferLetterEmail(updatedOffer);
      
      if (emailResult.success) {
        console.log('✅ Offer letter email sent successfully to:', updatedOffer.candidate_email);
      } else {
        console.log('⚠️ Email service returned unsuccessful result');
      }
    } catch (emailError) {
      console.error('❌ Failed to send offer letter email:', emailError);
      // Don't fail the entire operation if email fails, just log it
      // The offer letter is still marked as sent in the database
    }

    res.json({
      success: true,
      data: updatedOffer,
      message: 'Offer letter sent successfully'
    });
  } catch (error) {
    console.error('Error sending offer letter:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send offer letter'
    });
  }
};

// Get offer templates
const getOfferTemplates = async (req, res) => {
  try {
    console.log('=== GET OFFER TEMPLATES DEBUG ===');
    console.log('User:', req.user);
    console.log('Company ID:', req.user?.company_id);
    
    const companyId = req.user.company_id;
    
    if (!companyId) {
      console.log('ERROR: No company_id found in user object');
      return res.status(400).json({
        success: false,
        message: 'Company ID not found'
      });
    }

    console.log('Fetching templates for company:', companyId);

    const templates = await knex('offer_templates')
      .where('company_id', companyId)
      .where('is_active', true)
      .orderBy('is_default', 'desc')
      .orderBy('name', 'asc');

    console.log('Found templates:', templates.length);
    console.log('Templates data:', templates);

    res.json({
      success: true,
      data: templates
    });
  } catch (error) {
    console.error('Error fetching offer templates:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch offer templates'
    });
  }
};

// Create offer template
const createOfferTemplate = async (req, res) => {
  try {
    console.log('=== CREATE OFFER TEMPLATE DEBUG ===');
    console.log('User:', req.user);
    console.log('Company ID:', req.user?.company_id);
    console.log('Request body:', req.body);
    
    const companyId = req.user.company_id;
    const { name, content, variables, is_default } = req.body;
    
    if (!companyId) {
      console.log('ERROR: No company_id found in user object');
      return res.status(400).json({
        success: false,
        message: 'Company ID not found'
      });
    }

    console.log('Creating template:', { companyId, name, is_default });

    // If setting as default, unset other defaults
    if (is_default) {
      await knex('offer_templates')
        .where({ company_id: companyId })
        .update({ is_default: false });
    }

    // Insert the template
    const insertResult = await knex('offer_templates').insert({
      company_id: companyId,
      name,
      content,
      variables,
      is_default: is_default || false,
      created_by: req.user.id
    });

    // Fetch the created template
    const template = await knex('offer_templates')
      .where({ id: insertResult[0] })
      .first();

    console.log('Template created successfully:', template);

    res.status(201).json({
      success: true,
      data: template,
      message: 'Offer template created successfully'
    });
  } catch (error) {
    console.error('Error creating offer template:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create offer template'
    });
  }
};

// Update offer template
const updateOfferTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user.company_id;
    const { name, content, variables, is_default } = req.body;

    // Check if template exists and belongs to company
    const existingTemplate = await knex('offer_templates')
      .where({ id, company_id: companyId })
      .first();

    if (!existingTemplate) {
      return res.status(404).json({
        success: false,
        message: 'Offer template not found'
      });
    }

    // If setting as default, unset other defaults
    if (is_default) {
      await knex('offer_templates')
        .where({ company_id: companyId })
        .whereNot('id', id)
        .update({ is_default: false });
    }

    // Update the template
    const updateResult = await knex('offer_templates')
      .where({ id, company_id: companyId })
      .update({
        name,
        content,
        variables,
        is_default: is_default || false,
        updated_by: req.user.id,
        updated_at: new Date()
      });

    if (updateResult === 0) {
      return res.status(404).json({
        success: false,
        message: 'Offer template not found'
      });
    }

    // Fetch the updated template
    const updatedTemplate = await knex('offer_templates')
      .where({ id, company_id: companyId })
      .first();

    res.json({
      success: true,
      data: updatedTemplate,
      message: 'Offer template updated successfully'
    });
  } catch (error) {
    console.error('Error updating offer template:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update offer template'
    });
  }
};

// Delete offer template
const deleteOfferTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user.company_id;

    // Check if template is being used by any offer letters
    const templateUsage = await knex('offer_letters')
      .where({ 
        company_id: companyId,
        template: knex.raw('(SELECT name FROM offer_templates WHERE id = ?)', [id])
      })
      .first();

    if (templateUsage) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete template that is being used by offer letters'
      });
    }

    const deleted = await knex('offer_templates')
      .where({ id, company_id: companyId })
      .del();

    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: 'Offer template not found'
      });
    }

    res.json({
      success: true,
      message: 'Offer template deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting offer template:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete offer template'
    });
  }
};

module.exports = {
  getOfferLetters,
  getOfferLetterById,
  createOfferLetter,
  updateOfferLetter,
  deleteOfferLetter,
  sendOfferLetter,
  getOfferTemplates,
  createOfferTemplate,
  updateOfferTemplate,
  deleteOfferTemplate
};
