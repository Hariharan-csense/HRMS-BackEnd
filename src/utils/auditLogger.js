const knex = require('../db/db');

/**
 * Logs an audit trail for important actions in the system
 * @param {string} action - The action being performed (e.g., 'create', 'update', 'delete')
 * @param {string} tableName - The name of the table being affected
 * @param {number} recordId - The ID of the record being affected
 * @param {number} userId - The ID of the user performing the action
 * @param {object} changes - An object containing the changes made (for updates)
 * @param {object} metadata - Any additional metadata to store
 * @returns {Promise<void>}
 */
const logAudit = async (action, tableName, recordId, userId, changes = {}, metadata = {}) => {
  try {
    await knex('audit_logs').insert({
      action,
      table_name: tableName,
      record_id: recordId,
      performed_by: userId,
      old_values: Object.keys(changes).length > 0 ? JSON.stringify(changes) : null,
      new_values: Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : null,
      performed_at: new Date()
    });
  } catch (error) {
    console.error('Failed to log audit trail:', error);
    // Don't throw the error as we don't want to break the main operation
  }
};

/**
 * Gets audit logs with pagination and filtering
 * @param {object} options - Filtering and pagination options
 * @param {string} options.tableName - Filter by table name
 * @param {number} options.recordId - Filter by record ID
 * @param {number} options.userId - Filter by user ID
 * @param {Date} options.startDate - Start date for filtering
 * @param {Date} options.endDate - End date for filtering
 * @param {number} options.page - Page number (1-based)
 * @param {number} options.limit - Number of records per page
 * @returns {Promise<object>} - Paginated audit logs
 */
const getAuditLogs = async ({
  tableName,
  recordId,
  userId,
  startDate,
  endDate,
  page = 1,
  limit = 20
} = {}) => {
  try {
    const offset = (page - 1) * limit;
    
    let query = knex('audit_logs')
      .select(
        'audit_logs.*',
        'users.username',
        'users.email',
        'user_profiles.first_name',
        'user_profiles.last_name'
      )
      .leftJoin('users', 'audit_logs.performed_by', 'users.id')
      .leftJoin('user_profiles', 'users.id', 'user_profiles.user_id')
      .orderBy('audit_logs.performed_at', 'desc');
    
    // Apply filters
    if (tableName) {
      query = query.where('audit_logs.table_name', tableName);
    }
    
    if (recordId) {
      query = query.where('audit_logs.record_id', recordId);
    }
    
    if (userId) {
      query = query.where('audit_logs.performed_by', userId);
    }
    
    if (startDate) {
      query = query.where('audit_logs.performed_at', '>=', startDate);
    }
    
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      query = query.where('audit_logs.performed_at', '<=', end);
    }
    
    // Get total count
    const countResult = await query.clone().count('* as count').first();
    const total = parseInt(countResult.count, 10);
    
    // Apply pagination
    const data = await query.limit(limit).offset(offset);
    
    // Parse JSON fields
    const parsedData = data.map(log => ({
      ...log,
      old_values: log.old_values ? JSON.parse(log.old_values) : null,
      new_values: log.new_values ? JSON.parse(log.new_values) : null
    }));
    
    return {
      data: parsedData,
      pagination: {
        total,
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        totalPages: Math.ceil(total / limit)
      }
    };
  } catch (error) {
    console.error('Failed to fetch audit logs:', error);
    throw error;
  }
};

module.exports = {
  logAudit,
  getAuditLogs
};
