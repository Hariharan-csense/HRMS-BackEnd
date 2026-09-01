  const knex = require('../db/db');

  const closeExpiredRequirements = async (companyId, requirementId = null) => {
    const query = knex('job_requirements')
      .whereNot('status', 'closed')
      .whereNotNull('closing_date')
      // Keep it open through the closing date; close it the next day.
      .whereRaw('closing_date < CURRENT_DATE');

    if (companyId) {
      query.andWhere('company_id', companyId);
    }

    if (requirementId) {
      query.andWhere('id', requirementId);
    }

    return query.update({ status: 'closed', updated_at: knex.fn.now() });
  };

  // Get all job requirements for a company
  const getJobRequirements = async (req, res) => {
    try {
      const companyId = req.user.company_id;
      const { status, urgency, search } = req.query;

      await closeExpiredRequirements(companyId);

      let query = knex('job_requirements')
        .where('company_id', companyId)
        .orderBy('created_at', 'desc');

      // Apply filters
      if (status && status !== 'all') {
        query = query.where('status', status);
      }

      if (urgency && urgency !== 'all') {
        query = query.where('urgency', urgency);
      }

      if (search) {
        query = query.where(function() {
          this.whereRaw('LOWER(title) LIKE ?', [`%${String(search).toLowerCase()}%`])
              .orWhereRaw('LOWER(department) LIKE ?', [`%${String(search).toLowerCase()}%`])
              .orWhereRaw('LOWER(location) LIKE ?', [`%${String(search).toLowerCase()}%`]);
        });
      }

      const requirements = await query;

      res.json({
        success: true,
        data: requirements
      });
    } catch (error) {
      console.error('Error fetching job requirements:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch job requirements'
      });
    }
  };

  // Get job requirement by ID
  const getJobRequirementById = async (req, res) => {
    try {
      const { id } = req.params;
      const companyId = req.user.company_id;

      await closeExpiredRequirements(companyId, id);

      const requirement = await knex('job_requirements')
        .where({
          id,
          company_id: companyId
        })
        .first();

      if (!requirement) {
        return res.status(404).json({
          success: false,
          message: 'Job requirement not found'
        });
      }

      res.json({
        success: true,
        data: requirement
      });
    } catch (error) {
      console.error('Error fetching job requirement:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch job requirement'
      });
    }
  };

  // Create new job requirement
  const createJobRequirement = async (req, res) => {
    try {
      const companyId = req.user.company_id;
      const {
        title,
        department,
        location,
        experience,
        salary,
        description,
        status,
        positions,
        urgency,
        closing_date,
        required_skills,
        preferred_skills,
        qualifications,
        responsibilities,
        benefits
      } = req.body;

      const [requirementId] = await knex('job_requirements').insert({
        company_id: companyId,
        title,
        department,
        location,
        experience,
        salary,
        description,
        status: status || 'active',
        positions: positions || 1,
        urgency: urgency || 'medium',
        closing_date: closing_date || null,
        required_skills: required_skills ? JSON.stringify(required_skills) : null,
        preferred_skills: preferred_skills ? JSON.stringify(preferred_skills) : null,
        qualifications,
        responsibilities,
        benefits,
        created_by: req.user.id
      });

      await closeExpiredRequirements(companyId, requirementId);

      const requirement = await knex('job_requirements')
        .where({ id: requirementId, company_id: companyId })
        .first();

      res.status(201).json({
        success: true,
        data: requirement,
        message: 'Job requirement created successfully'
      });
    } catch (error) {
      console.error('Error creating job requirement:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to create job requirement'
      });
    }
  };

  // Update job requirement
  const updateJobRequirement = async (req, res) => {
    try {
      const { id } = req.params;
      const companyId = req.user.company_id;
      const updateData = { ...req.body, updated_by: req.user.id };

      if (Object.prototype.hasOwnProperty.call(updateData, 'closing_date')) {
        updateData.closing_date = updateData.closing_date || null;
      }

      // Handle JSON fields
      if (updateData.required_skills) {
        updateData.required_skills = JSON.stringify(updateData.required_skills);
      }
      if (updateData.preferred_skills) {
        updateData.preferred_skills = JSON.stringify(updateData.preferred_skills);
      }

      // First update the record
      const updated = await knex('job_requirements')
        .where({ id, company_id: companyId })
        .update(updateData);

      if (!updated) {
        return res.status(404).json({
          success: false,
          message: 'Job requirement not found'
        });
      }

      await closeExpiredRequirements(companyId, id);

      // Then fetch the updated record
      const updatedRequirement = await knex('job_requirements')
        .where({ id, company_id: companyId })
        .first();

      res.json({
        success: true,
        data: updatedRequirement,
        message: 'Job requirement updated successfully'
      });
    } catch (error) {
      console.error('Error updating job requirement:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update job requirement'
      });
    }
  };

  // Delete job requirement
  const deleteJobRequirement = async (req, res) => {
    try {
      const { id } = req.params;
      const companyId = req.user.company_id;

      const deleted = await knex('job_requirements')
        .where({ id, company_id: companyId })
        .del();

      if (!deleted) {
        return res.status(404).json({
          success: false,
          message: 'Job requirement not found'
        });
      }

      res.json({
        success: true,
        message: 'Job requirement deleted successfully'
      });
    } catch (error) {
      console.error('Error deleting job requirement:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to delete job requirement'
      });
    }
  };

  // Update filled positions count
  const updateFilledPositions = async (req, res) => {
    try {
      const { id } = req.params;
      const { filled_positions } = req.body;
      const companyId = req.user.company_id;

      const updated = await knex('job_requirements')
        .where({ id, company_id: companyId })
        .update({ filled_positions });

      if (!updated) {
        return res.status(404).json({
          success: false,
          message: 'Job requirement not found'
        });
      }

      let updatedRequirement = await knex('job_requirements')
        .where({ id, company_id: companyId })
        .first();

      // Check if all positions are filled, then update status to closed
      if (updatedRequirement.filled_positions >= updatedRequirement.positions) {
        await knex('job_requirements')
          .where({ id, company_id: companyId })
          .update({ status: 'closed' });
        updatedRequirement = {
          ...updatedRequirement,
          status: 'closed'
        };
      }

      res.json({
        success: true,
        data: updatedRequirement,
        message: 'Filled positions updated successfully'
      });
    } catch (error) {
      console.error('Error updating filled positions:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update filled positions'
      });
    }
  };

  // Get job requirements statistics
  const getJobRequirementsStats = async (req, res) => {
    try {
      const companyId = req.user.company_id;

      await closeExpiredRequirements(companyId);

      const stats = await knex('job_requirements')
        .where('company_id', companyId)
        .select(
          knex.raw('COUNT(*) as total'),
          knex.raw('COUNT(CASE WHEN status = \'active\' THEN 1 END) as active'),
          knex.raw('COUNT(CASE WHEN status = \'closed\' THEN 1 END) as closed'),
          knex.raw('COUNT(CASE WHEN status = \'on-hold\' THEN 1 END) as on_hold'),
          knex.raw('COUNT(CASE WHEN urgency = \'high\' THEN 1 END) as high_urgency'),
          knex.raw('SUM(positions) as total_positions'),
          knex.raw('SUM(filled_positions) as total_filled')
        )
        .first();

      res.json({
        success: true,
        data: stats
      });
    } catch (error) {
      console.error('Error fetching job requirements stats:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch job requirements statistics'
      });
    }
  };

  module.exports = {
    getJobRequirements,
    getJobRequirementById,
    createJobRequirement,
    updateJobRequirement,
    deleteJobRequirement,
    updateFilledPositions,
    getJobRequirementsStats,
    closeExpiredRequirements
  };
