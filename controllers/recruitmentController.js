const knex = require('../db/db');

// Get all candidates for a company
const getCandidates = async (req, res) => {
  try {
    const companyId = req.user.company_id;
    const { status, search } = req.query;

    let query = knex('recruitment_candidates')
      .where('company_id', companyId)
      .orderBy('created_at', 'desc');

    // Apply filters
    if (status && status !== 'all') {
      query = query.where('status', status);
    }

    if (search) {
      query = query.where(function() {
        this.where('name', 'ilike', `%${search}%`)
            .orWhere('email', 'ilike', `%${search}%`)
            .orWhere('position', 'ilike', `%${search}%`);
      });
    }

    const candidates = await query;

    res.json({
      success: true,
      data: candidates
    });
  } catch (error) {
    console.error('Error fetching candidates:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch candidates'
    });
  }
};

// Get candidate by ID with interviews
const getCandidateById = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user.company_id;

    const candidate = await knex('recruitment_candidates')
      .where({
        id,
        company_id: companyId
      })
      .first();

    if (!candidate) {
      return res.status(404).json({
        success: false,
        message: 'Candidate not found'
      });
    }

    // Get candidate interviews
    const interviews = await knex('candidate_interviews')
      .where('candidate_id', id)
      .orderBy('interview_date', 'asc');

    res.json({
      success: true,
      data: {
        ...candidate,
        interviews
      }
    });
  } catch (error) {
    console.error('Error fetching candidate:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch candidate'
    });
  }
};

// Create new candidate
const createCandidate = async (req, res) => {
  try {
    const companyId = req.user.company_id;
    const {
      name,
      email,
      phone,
      position,
      department,
      experience,
      current_company,
      expected_salary,
      notice_period,
      skills,
      resume_url,
      source,
      notes
    } = req.body;

    // Check if candidate with email already exists
    const existingCandidate = await knex('recruitment_candidates')
      .where({
        email,
        company_id: companyId
      })
      .first();

    if (existingCandidate) {
      return res.status(400).json({
        success: false,
        message: 'Candidate with this email already exists'
      });
    }

    const insertResult = await knex('recruitment_candidates').insert({
      company_id: companyId,
      name,
      email,
      phone,
      position,
      department,
      experience,
      current_company,
      expected_salary,
      notice_period,
      skills: skills ? JSON.stringify(skills) : null,
      resume_url,
      source,
      notes,
      applied_date: new Date(),
      created_by: req.user.id
    });

    // Get the inserted record (returning() doesn't work well with MySQL)
    const newCandidate = await knex('recruitment_candidates')
      .where('id', insertResult[0])
      .first();

    res.status(201).json({
      success: true,
      data: newCandidate,
      message: 'Candidate created successfully'
    });
  } catch (error) {
    console.error('Error creating candidate:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create candidate'
    });
  }
};

// Update candidate
const updateCandidate = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user.company_id;
    const updateData = { ...req.body, updated_by: req.user.id };

    // Handle skills array
    if (updateData.skills) {
      updateData.skills = JSON.stringify(updateData.skills);
    }

    const updateResult = await knex('recruitment_candidates')
      .where({ id, company_id: companyId })
      .update(updateData);

    // Get the updated record (returning() doesn't work well with MySQL)
    const updatedCandidate = await knex('recruitment_candidates')
      .where('id', id)
      .first();

    if (!updatedCandidate) {
      return res.status(404).json({
        success: false,
        message: 'Candidate not found'
      });
    }

    res.json({
      success: true,
      data: updatedCandidate,
      message: 'Candidate updated successfully'
    });
  } catch (error) {
    console.error('Error updating candidate:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update candidate'
    });
  }
};

// Update candidate status
const updateCandidateStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const companyId = req.user.company_id;

    const updateResult = await knex('recruitment_candidates')
      .where({ id, company_id: companyId })
      .update({
        status,
        updated_by: req.user.id
      });

    // Get the updated record (returning() doesn't work well with MySQL)
    const updatedCandidate = await knex('recruitment_candidates')
      .where('id', id)
      .first();

    if (!updatedCandidate) {
      return res.status(404).json({
        success: false,
        message: 'Candidate not found'
      });
    }

    res.json({
      success: true,
      data: updatedCandidate,
      message: 'Candidate status updated successfully'
    });
  } catch (error) {
    console.error('Error updating candidate status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update candidate status'
    });
  }
};

// Delete candidate
const deleteCandidate = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user.company_id;

    const deleted = await knex('recruitment_candidates')
      .where({ id, company_id: companyId })
      .del();

    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: 'Candidate not found'
      });
    }

    res.json({
      success: true,
      message: 'Candidate deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting candidate:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete candidate'
    });
  }
};

// Create interview for candidate
const createInterview = async (req, res) => {
  try {
    const { id } = req.params; // candidate_id
    const companyId = req.user.company_id;
    const {
      type,
      interview_date,
      interview_time,
      interviewer
    } = req.body;

    // Verify candidate exists
    const candidate = await knex('recruitment_candidates')
      .where({ id, company_id: companyId })
      .first();

    if (!candidate) {
      return res.status(404).json({
        success: false,
        message: 'Candidate not found'
      });
    }

    const insertResult = await knex('candidate_interviews').insert({
      candidate_id: id,
      type,
      interview_date,
      interview_time,
      interviewer,
      created_by: req.user.id
    });

    // Get the inserted record (returning() doesn't work well with MySQL)
    const interview = await knex('candidate_interviews')
      .where('id', insertResult[0])
      .first();

    res.status(201).json({
      success: true,
      data: interview,
      message: 'Interview scheduled successfully'
    });
  } catch (error) {
    console.error('Error creating interview:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create interview'
    });
  }
};

// Update interview
const updateInterview = async (req, res) => {
  try {
    const { interviewId } = req.params;
    const { status, feedback, rating } = req.body;

    const updateResult = await knex('candidate_interviews')
      .where('id', interviewId)
      .update({
        status,
        feedback,
        rating
      });

    // Get the updated record (returning() doesn't work well with MySQL)
    const updatedInterview = await knex('candidate_interviews')
      .where('id', interviewId)
      .first();

    if (!updatedInterview) {
      return res.status(404).json({
        success: false,
        message: 'Interview not found'
      });
    }

    res.json({
      success: true,
      data: updatedInterview,
      message: 'Interview updated successfully'
    });
  } catch (error) {
    console.error('Error updating interview:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update interview'
    });
  }
};

// Get recruitment statistics
const getRecruitmentStats = async (req, res) => {
  try {
    const companyId = req.user.company_id;

    const stats = await knex('recruitment_candidates')
      .where('company_id', companyId)
      .select(
        knex.raw('COUNT(*) as total'),
        knex.raw('COUNT(CASE WHEN status = \'applied\' THEN 1 END) as applied'),
        knex.raw('COUNT(CASE WHEN status = \'screening\' THEN 1 END) as screening'),
        knex.raw('COUNT(CASE WHEN status = \'interview\' THEN 1 END) as interview'),
        knex.raw('COUNT(CASE WHEN status = \'technical\' THEN 1 END) as technical'),
        knex.raw('COUNT(CASE WHEN status = \'hr-round\' THEN 1 END) as hr_round'),
        knex.raw('COUNT(CASE WHEN status = \'offered\' THEN 1 END) as offered'),
        knex.raw('COUNT(CASE WHEN status = \'rejected\' THEN 1 END) as rejected'),
        knex.raw('COUNT(CASE WHEN status = \'hired\' THEN 1 END) as hired')
      )
      .first();

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Error fetching recruitment stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch recruitment statistics'
    });
  }
};

module.exports = {
  getCandidates,
  getCandidateById,
  createCandidate,
  updateCandidate,
  updateCandidateStatus,
  deleteCandidate,
  createInterview,
  updateInterview,
  getRecruitmentStats
};
