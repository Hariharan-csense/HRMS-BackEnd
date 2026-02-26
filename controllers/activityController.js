// controllers/activityController.js
const knex = require('../db/db');

// @desc    Get user activities
// @route   GET /api/activities
// @access  Private
const getActivities = async (req, res) => {
  try {
    const employeeId = req.user.id;
    const companyId = req.user.company_id;
    
    console.log('ACTIVITY DEBUG - Fetching activities:', {
      employeeId,
      companyId,
      userType: req.user.type,
      email: req.user.email
    });

    const activities = await knex('user_activities')
      .join('employees', 'user_activities.employee_id', 'employees.id')
      .where('user_activities.employee_id', employeeId)
      .andWhere('employees.company_id', companyId) // ✅ CRITICAL: Filter by company_id
      .select(
        'user_activities.id',
        'user_activities.action',
        'user_activities.location',
        'user_activities.ip_address',
        'user_activities.created_at'
      )
      .orderBy('user_activities.created_at', 'desc')
      .limit(20); // Get last 20 activities

    console.log('ACTIVITY DEBUG - Activities found:', activities.length);

    // Format activities for frontend
    const formattedActivities = activities.map(activity => ({
      id: activity.id,
      action: activity.action,
      location: activity.location,
      date: formatDate(activity.created_at),
      timestamp: activity.created_at
    }));

    res.status(200).json({
      success: true,
      data: formattedActivities
    });
  } catch (error) {
    console.error('Error fetching activities:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch activities',
      error: error.message
    });
  }
};

// @desc    Log new activity
// @route   POST /api/activities
// @access  Private
const logActivity = async (req, res) => {
  try {
    const { action, location, timestamp, date } = req.body;
    const employeeId = req.user.id;
    const companyId = req.user.company_id;
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.get('User-Agent');
    
    console.log('ACTIVITY LOG DEBUG - Logging activity:', {
      employeeId,
      companyId,
      action,
      userType: req.user.type,
      email: req.user.email
    });
    
    // Validate required fields
    if (!action) {
      return res.status(400).json({
        success: false,
        message: 'Action is required'
      });
    }

    // Verify employee belongs to the company before logging activity
    const employee = await knex('employees')
      .where('id', employeeId)
      .andWhere('company_id', companyId)
      .first();

    if (!employee) {
      console.log('ACTIVITY LOG DEBUG - Employee not found for company:', companyId);
      return res.status(404).json({
        success: false,
        message: 'Employee not found or unauthorized'
      });
    }

    // Insert activity into database
    const [newActivity] = await knex('user_activities')
      .insert({
        employee_id: employeeId,
        action: action,
        location: location || 'Unknown',
        ip_address: ipAddress,
        user_agent: userAgent,
        created_at: timestamp || new Date()
      })
      .returning(['id', 'action', 'location', 'created_at']);

    console.log('ACTIVITY LOG DEBUG - Activity logged successfully:', {
      activityId: newActivity.id,
      employeeId,
      companyId
    });

    // Format response
    const formattedActivity = {
      id: newActivity.id,
      action: newActivity.action,
      location: newActivity.location,
      date: formatDate(newActivity.created_at),
      timestamp: newActivity.created_at
    };

    res.status(201).json({
      success: true,
      message: 'Activity logged successfully',
      data: formattedActivity
    });
  } catch (error) {
    console.error('Error logging activity:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to log activity',
      error: error.message
    });
  }
};

// Helper function to format date
function formatDate(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const activityDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (activityDate.getTime() === today.getTime()) {
    return `Today at ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`;
  }

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (activityDate.getTime() === yesterday.getTime()) {
    return `Yesterday at ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`;
  }

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

module.exports = {
  getActivities,
  logActivity
};
