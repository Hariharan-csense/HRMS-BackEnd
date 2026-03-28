const db = require('../db/db');

// Create a new survey with email sending (Admin only)
const createSurvey = async (req, res) => {
  const {
    title,
    message,
    recipientType = "all",
    selectedEmployee,
    selectedDepartment,
    selectedDesignation,
    allowAnonymous = false,
    category = "general"
  } = req.body;

  const empList = Array.isArray(selectedEmployee) ? selectedEmployee : [];
  const deptList = Array.isArray(selectedDepartment) ? selectedDepartment : [];
  const desigList = Array.isArray(selectedDesignation) ? selectedDesignation : [];

  const sentAt = new Date();
  const { company_id } = req.user; // Admin's company_id

  try {
    // 1️⃣ Build recipients query
    let query = db("employees")
      .select("id", "full_name", "email", "department", "designation")
      .where("company_id", company_id);

    if (recipientType === "employee" && empList.length > 0) {
      query.whereIn("id", empList);
    } else if (recipientType === "department" && deptList.length > 0) {
      query.whereIn("department", deptList);
    } else if (recipientType === "designation" && desigList.length > 0) {
      query.whereIn("designation", desigList);
    }

    const recipients = await query;

    if (recipients.length === 0) {
      return res.status(400).json({
        error: "No recipients found for the selected criteria."
      });
    }

    // 2️⃣ Insert survey session with status = "pending" by default
    const [surveyId] = await db("SurveySession").insert({
      title,
      message,
      sentAt,
      createdAt: new Date(),
      recipientType,
      selectedEmployee: empList.length ? JSON.stringify(empList) : null,
      selectedDepartment: deptList.length ? JSON.stringify(deptList) : null,
      selectedDesignation: desigList.length ? JSON.stringify(desigList) : null,
      totalSent: recipients.length,
      allowAnonymous: allowAnonymous ? 1 : 0,
      category,
      company_id,
      status: "pending" // 🔥 NEW: Default status
    });

    // 3️⃣ Send emails in parallel
    await Promise.all(
      recipients.map(emp =>
        sendSurveyMail({
          to: emp.email,
          fullName: emp.full_name,
          title,
          message,
          surveyId,
          allowAnonymous
        })
      )
    );

    // Optional: Update status to "sent" after emails are dispatched
    await db("SurveySession")
      .where("id", surveyId)
      .update({ status: "sent" });

    // 4️⃣ Return success response
    return res.status(201).json({
      message: "Survey created and emails sent successfully!",
      surveyId,
      totalSent: recipients.length,
      allowAnonymous: !!allowAnonymous,
      status: "sent" // Reflect final status
    });

  } catch (error) {
    console.error("Error creating survey:", error);

    if (error.code === "ER_DUP_ENTRY") {
      return res.status(400).json({
        error: "Duplicate entry – survey may already exist."
      });
    }

    return res.status(500).json({
      error: "Failed to create survey",
      details: process.env.NODE_ENV === "development" ? error.message : undefined
    });
  }
};

// Get all surveys for admin
const getSurveys = async (req, res) => {
  try {
    const companyId = req.user.company_id;
    const surveys = await db('surveys')
      .where('company_id', companyId)
      .orderBy('created_at', 'desc');

    const surveysWithQuestions = surveys.map(survey => ({
      ...survey,
      questions: JSON.parse(survey.questions)
    }));

    res.json(surveysWithQuestions);
  } catch (error) {
    console.error('Error fetching surveys:', error);
    res.status(500).json({ error: 'Failed to fetch surveys' });
  }
};

// Get active surveys for employees
const getActiveSurveys = async (req, res) => {
  try {
    const employeeId = req.user.id;
    const companyId = req.user.company_id;

    // Get surveys that are active and employee hasn't responded to
    const surveys = await db('surveys')
      .leftJoin('survey_responses', function() {
        this.on('surveys.id', '=', 'survey_responses.survey_id')
            .andOn('survey_responses.employee_id', '=', db.raw('?', [employeeId]));
      })
      .where('surveys.company_id', companyId)
      .where('surveys.status', 'active')
      .whereNull('survey_responses.id')
      .select('surveys.*')
      .orderBy('surveys.created_at', 'desc');

    const surveysWithQuestions = surveys.map(survey => ({
      ...survey,
      questions: JSON.parse(survey.questions)
    }));

    res.json(surveysWithQuestions);
  } catch (error) {
    console.error('Error fetching active surveys:', error);
    res.status(500).json({ error: 'Failed to fetch active surveys' });
  }
};

// Get survey by ID
const getSurveyById = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user.company_id;

    const [survey] = await db('surveys')
      .where('id', id)
      .where('company_id', companyId)
      .first();

    if (!survey) {
      return res.status(404).json({ error: 'Survey not found' });
    }

    res.json({
      ...survey,
      questions: JSON.parse(survey.questions)
    });
  } catch (error) {
    console.error('Error fetching survey:', error);
    res.status(500).json({ error: 'Failed to fetch survey' });
  }
};

// Submit survey response (Employee only) - Updated version
const submitSurveyResponse = async (req, res) => {
  const { surveyId, score, comments, isAnonymous } = req.body;

  try {
    if (!surveyId || score === undefined || score === null) {
      return res.status(400).json({ error: "surveyId and score are required" });
    }
    if (score < 1 || score > 10) {
      return res.status(400).json({ error: "Score must be between 1 and 10" });
    }

    const anonymous = isAnonymous === true || isAnonymous === "true";
    const employeeId = req.user.id; // 🔥 ALWAYS store actual employeeId

    let employeeName = null;
    let department = null;

    // Only fetch name/department if NOT anonymous (for display in admin reports)
    if (!anonymous) {
      const employee = await db("employees")
        .where({ id: employeeId })
        .select("full_name as name", "department")
        .first();

      if (!employee) {
        return res.status(404).json({ error: "Employee not found" });
      }

      employeeName = employee.name;
      department = employee.department;
    }
    // If anonymous → employeeName & department = null (hidden in reports)

    const responseData = {
      surveyId: Number(surveyId),
      score: Number(score),
      comments: comments?.trim() || null,
      createdAt: new Date(),
      
      isAnonymous: anonymous ? 1 : 0,  // 1 = anonymous
      employeeId: employeeId,         // 🔥 ALWAYS store real ID
      employeeName,                   // null if anonymous
      department,                     // null if anonymous
    };

    const existing = await db("surveyresponses")
      .where({
        surveyId: responseData.surveyId,
        employeeId: responseData.employeeId,
      })
      .first();

    let isNewResponse = !existing;

    if (existing) {
      await db("surveyresponses")
        .where({ id: existing.id })
        .update(responseData);
    } else {
      await db("surveyresponses").insert(responseData);
    }

    // Update survey status to "responded" on first response
    if (isNewResponse) {
      await db("SurveySession")
        .where({ id: surveyId })
        .whereNot("status", "responded")
        .update({ status: "responded" });
    }

    return res.json({
      message: anonymous
        ? "Thank you! Your anonymous feedback was recorded."
        : existing
        ? "Your response has been updated!"
        : "Thank you! Your response has been saved.",
      status: "success",
    });

  } catch (error) {
    console.error("Survey save error:", error);
    res.status(500).json({ error: "Failed to save survey response" });
  }
};

// Update survey response (Employee only)
const updateSurveyResponse = async (req, res) => {
  const { surveyId } = req.params;
  const { score, comments, isAnonymous } = req.body;

  const { id: employeeId, role, company_id } = req.user;

  // Employee only
  if (role !== "employee") {
    return res.status(403).json({ error: "Only employees can respond to surveys" });
  }

  if (!employeeId || !company_id) {
    return res.status(401).json({ error: "Unauthorized - Invalid token" });
  }

  try {
    // Validate score
    if (score === undefined || score === null) {
      return res.status(400).json({ error: "Score is required" });
    }

    if (score < 1 || score > 10) {
      return res.status(400).json({ error: "Score must be between 1 and 10" });
    }

    const responseData = {
      score,
      comments: comments?.trim() || null,
      isAnonymous: !!isAnonymous
    };

    // 🔥 COMPANY-SAFE UPDATE
    const updatedCount = await db("surveyresponses as sr")
      .join("employees as e", "sr.employeeId", "e.id")
      .where("sr.surveyId", parseInt(surveyId))
      .andWhere("sr.employeeId", employeeId)
      .andWhere("e.company_id", company_id) // 🔐 COMPANY CHECK
      .update(responseData);

    if (updatedCount === 0) {
      return res.status(404).json({
        error: "Survey response not found or access denied"
      });
    }

    res.status(200).json({
      message: "Survey response updated successfully!",
      status: "success"
    });

  } catch (error) {
    console.error("Error while updating response:", error);
    res.status(500).json({
      error: "Internal Server Error"
    });
  }
};

// Get survey responses (Admin only)
const getSurveyResponses = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user.company_id;

    // Check if survey exists and belongs to company
    const [survey] = await db('surveys')
      .where('id', id)
      .where('company_id', companyId)
      .first();

    if (!survey) {
      return res.status(404).json({ error: 'Survey not found' });
    }

    // Get all responses for this survey
    const responses = await db('survey_responses')
      .join('users', 'survey_responses.employee_id', 'users.id')
      .where('survey_responses.survey_id', id)
      .select(
        'survey_responses.*',
        'users.name as employee_name',
        'users.email as employee_email'
      )
      .orderBy('survey_responses.submitted_at', 'desc');

    const responsesWithParsedData = responses.map(response => ({
      ...response,
      responses: JSON.parse(response.responses)
    }));

    res.json({
      survey: {
        ...survey,
        questions: JSON.parse(survey.questions)
      },
      responses: responsesWithParsedData,
      totalResponses: responses.length
    });
  } catch (error) {
    console.error('Error fetching survey responses:', error);
    res.status(500).json({ error: 'Failed to fetch survey responses' });
  }
};

// Update survey status (Admin only)
const updateSurveyStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const companyId = req.user.company_id;

    if (!['draft', 'active', 'closed'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const [survey] = await db('surveys')
      .where('id', id)
      .where('company_id', companyId)
      .update({ status })
      .returning('*');

    if (!survey) {
      return res.status(404).json({ error: 'Survey not found' });
    }

    res.json({
      message: 'Survey status updated successfully',
      survey: {
        ...survey,
        questions: JSON.parse(survey.questions)
      }
    });
  } catch (error) {
    console.error('Error updating survey status:', error);
    res.status(500).json({ error: 'Failed to update survey status' });
  }
};

// Submit general employee feedback (Employee only)
const submitFeedback = async (req, res) => {
  const { feedback, category = 'general', isAnonymous = true } = req.body;
  const employeeId = req.user.id;
  const companyId = req.user.company_id;

  try {
    if (req.user.type !== 'employee') {
      return res.status(403).json({ error: 'Only employee logins can submit feedback' });
    }

    if (!feedback || feedback.trim() === '') {
      return res.status(400).json({ error: 'Feedback text is required' });
    }

    let employeeName = null;
    let department = null;

    // Only fetch employee details if NOT anonymous
    if (!isAnonymous) {
      const employee = await db('employees as e')
        .leftJoin('departments as d', 'e.department_id', 'd.id')
        .where({ 'e.id': employeeId, 'e.company_id': companyId })
        .select('e.first_name', 'e.last_name', 'd.name as department')
        .first();

      if (!employee) {
        return res.status(404).json({ error: 'Employee not found' });
      }

      employeeName = `${employee.first_name} ${employee.last_name || ''}`.trim();
      department = employee.department || null;
    }

    const [feedbackId] = await db('employee_feedback').insert({
      feedback: feedback.trim(),
      category,
      employeeId,
      employeeName: isAnonymous ? null : employeeName,
      department: isAnonymous ? null : department,
      isAnonymous: isAnonymous ? 1 : 0,
      companyId,
      status: 'submitted',
      createdAt: new Date(),
      updatedAt: null,
    });

    res.status(201).json({
      message: isAnonymous 
        ? 'Thank you! Your anonymous feedback has been submitted.' 
        : 'Thank you! Your feedback has been submitted.',
      feedbackId
    });

  } catch (error) {
    console.error('Error submitting feedback:', error);
    res.status(500).json({ error: 'Failed to submit feedback' });
  }
};

// Get all feedback for admin review
const getFeedback = async (req, res) => {
  const companyId = req.user.company_id;

  try {
    const feedback = await db('employee_feedback')
      .where('companyId', companyId)
      .orderBy('createdAt', 'desc');

    res.json({
      feedback,
      total: feedback.length
    });

  } catch (error) {
    console.error('Error fetching feedback:', error);
    res.status(500).json({ error: 'Failed to fetch feedback' });
  }
};

// Update feedback status (Admin only)
const updateFeedbackStatus = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const companyId = req.user.company_id;

  try {
    if (!['submitted', 'reviewed', 'resolved', 'dismissed'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const updated = await db('employee_feedback')
      .where({ id })
      .where('companyId', companyId)
      .update({ status, updatedAt: new Date() });

    if (updated === 0) {
      return res.status(404).json({ error: 'Feedback not found' });
    }

    res.json({
      message: 'Feedback status updated successfully'
    });

  } catch (error) {
    console.error('Error updating feedback status:', error);
    res.status(500).json({ error: 'Failed to update feedback status' });
  }
};

// Delete feedback (Admin only)
const deleteFeedback = async (req, res) => {
  const { id } = req.params;
  const companyId = req.user.company_id;

  try {
    const deleted = await db('employee_feedback')
      .where({ id })
      .where('companyId', companyId)
      .del();

    if (deleted === 0) {
      return res.status(404).json({ error: 'Feedback not found' });
    }

    res.json({
      message: 'Feedback deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting feedback:', error);
    res.status(500).json({ error: 'Failed to delete feedback' });
  }
};
const deleteSurvey = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user.company_id;

    const [survey] = await db('surveys')
      .where('id', id)
      .where('company_id', companyId)
      .del()
      .returning('*');

    if (!survey) {
      return res.status(404).json({ error: 'Survey not found' });
    }

    res.json({ message: 'Survey deleted successfully' });
  } catch (error) {
    console.error('Error deleting survey:', error);
    res.status(500).json({ error: 'Failed to delete survey' });
  }
};

module.exports = {
  createSurvey,
  getSurveys,
  getActiveSurveys,
  getSurveyById,
  submitSurveyResponse,
  updateSurveyResponse,
  getSurveyResponses,
  updateSurveyStatus,
  deleteSurvey,
  submitFeedback,
  getFeedback,
  updateFeedbackStatus,
  deleteFeedback
};
