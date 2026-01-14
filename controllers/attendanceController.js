// src/controllers/attendanceController.js
const knex = require('../db/db');

// Check-in employee
const checkIn = async (req, res) => {
  const companyId = req.user.company_id;
  if (!companyId) {
    return res.status(400).json({ message: 'Company not assigned to user' });
  }

  // Handle FormData - get fields from req.body and file from req.file
  const employeeId = req.body.employeeId;
  const imageData = req.file; // For FormData, file comes from req.file
  const location = req.body.location ? JSON.parse(req.body.location) : null;
  const deviceInfo = req.body.deviceInfo;
  const userId = req.user.id;

  try {
    // Verify employee belongs to same company
    const employee = await knex('employees')
      .where({ id: employeeId, company_id: companyId })
      .first();

    if (!employee) {
      return res.status(404).json({ message: 'Employee not found or access denied' });
    }

    // Verify face if image data is provided
    if (imageData) {
      const faceMatch = await verifyFace(employeeId, imageData);
      if (!faceMatch) {
        return res.status(400).json({ message: 'Face verification failed' });
      }
    }

    // Check if already checked in today
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const existingCheckIn = await knex('attendance')
      .where('employee_id', employeeId)
      .where('company_id', companyId)
      .where('check_in', '>=', today)
      .whereNull('check_out')
      .first();

    if (existingCheckIn) {
      return res.status(400).json({ message: 'Already checked in today' });
    }

    // Get employee shift information
    const employeeShift = await getEmployeeShift(employeeId, companyId);
    
    // Determine shift type
    const shiftType = determineShiftType(new Date(), employeeShift);
    
    // Create attendance record
    const [attendance] = await knex('attendance')
      .insert({
        company_id: companyId, // ← Company isolation
        employee_id: employeeId,
        check_in: new Date(),
        check_in_location: location ? JSON.stringify(location) : null,
        check_in_image_url: imageData ? await saveImage(imageData) : null,
        device_info: deviceInfo || 'Web',
        status: 'present',
        shift_type: shiftType,
        shift_id: employeeShift?.shift_id || null
      })
      .returning('*');

    // Log check-in
    // await logAudit('check_in', 'attendance', attendance.id, userId, {
    //   employee_id: employeeId,
    //   check_in: attendance.check_in
    // });

    res.status(201).json({
      success: true,
      message: 'Checked in successfully',
      attendance
    });
  } catch (error) {
    console.error('Check-in error:', error);
    res.status(500).json({ message: 'Error processing check-in' });
  }
};

// Check-out employee
const checkOut = async (req, res) => {
  const companyId = req.user.company_id;
  if (!companyId) {
    return res.status(400).json({ message: 'Company not assigned to user' });
  }

  // Handle FormData - get fields from req.body and file from req.file
  const imageData = req.file; // For FormData, file comes from req.file
  const location = req.body.location ? JSON.parse(req.body.location) : null;
  const deviceInfo = req.body.deviceInfo;
  const employeeId = req.user.id;

  try {
    // Find today's active check-in for this employee in company
    const checkInRecord = await knex('attendance')
      .where({
        employee_id: employeeId,
        company_id: companyId
      })
      .whereNull('check_out')
      .whereRaw('DATE(check_in) = CURDATE()')
      .first();

    if (!checkInRecord) {
      return res.status(400).json({ message: 'No active check-in found for today' });
    }

    // Get employee shift information for overtime calculation
    const employeeShift = await getEmployeeShift(employeeId, companyId);

    // Face verification (optional)
    if (imageData) {
      const faceMatch = await verifyFace(employeeId, imageData);
      if (!faceMatch) {
        return res.status(400).json({ message: 'Face verification failed' });
      }
    }

    // Calculate hours based on shift
    const checkOutTime = new Date();
    const checkInTime = new Date(checkInRecord.check_in);
    let hoursWorked = (checkOutTime - checkInTime) / (1000 * 60 * 60);
    
    // Ensure minimum of 1 minute worked if check-out is same as check-in
    if (hoursWorked < 0.0167) { // Less than 1 minute
      hoursWorked = 0.0167; // Set to 1 minute
    }
    
    console.log('Hours calculation debug:', {
      checkOutTime: checkOutTime.toISOString(),
      checkInTime: checkInTime.toISOString(),
      hoursWorked: hoursWorked,
      checkInRecord: checkInRecord
    });
    
    // Use shift duration for standard hours if available, otherwise default to 8
    let standardHours = 8;
    if (employeeShift && employeeShift.start_time && employeeShift.end_time) {
      const [startHour, startMin] = employeeShift.start_time.split(':').map(Number);
      const [endHour, endMin] = employeeShift.end_time.split(':').map(Number);
      const startTime = new Date();
      startTime.setHours(startHour, startMin, 0, 0);
      const endTime = new Date();
      endTime.setHours(endHour, endMin, 0, 0);
      
      // Handle overnight shifts
      if (endTime < startTime) {
        endTime.setDate(endTime.getDate() + 1);
      }
      
      standardHours = (endTime - startTime) / (1000 * 60 * 60);
    }
    
    const overtimeHours = Math.max(0, hoursWorked - standardHours);

    console.log('Final hours to save:', {
      hoursWorked: hoursWorked,
      overtimeHours: overtimeHours
    });

    // Update attendance
    await knex('attendance')
      .where('id', checkInRecord.id)
      .update({
        check_out: checkOutTime,
        check_out_location: location ? JSON.stringify(location) : null,
        check_out_image_url: imageData ? await saveImage(imageData) : null,
        hours_worked: hoursWorked,
        overtime_hours: overtimeHours,
        device_info: deviceInfo || 'Web'
      });

    const updatedAttendance = await knex('attendance')
      .where('id', checkInRecord.id)
      .first();

    // Audit log
    // await logAudit(
    //   'check_out',
    //   'attendance',
    //   updatedAttendance.id,
    //   req.user.id,
    //   {
    //     employee_id: employeeId,
    //     check_out: updatedAttendance.check_out,
    //     hours_worked: updatedAttendance.hours_worked
    //   }
    // );

    return res.json({
      success: true,
      message: 'Checked out successfully',
      attendance: updatedAttendance
    });

  } catch (error) {
    console.error('Check-out error:', error);
    return res.status(500).json({ message: 'Error processing check-out' });
  }
};

// Get attendance logs (company scoped)
const getAttendanceLogs = async (req, res) => {
  const companyId = req.user.company_id;
  if (!companyId) {
    return res.status(400).json({ message: 'Company not assigned to user' });
  }

  const {
    employeeId,
    startDate,
    endDate,
    status,
    page = 1,
    limit = 10
  } = req.query;

  const pageNum = parseInt(page, 10);
  const limitNum = parseInt(limit, 10);
  const offset = (pageNum - 1) * limitNum;

  try {
    let baseQuery = knex('attendance')
      .leftJoin('employees', 'attendance.employee_id', 'employees.id')
      .where('attendance.company_id', companyId);

    // 🔹 Role-based filtering
    if (req.user.role === 'employee') {
      baseQuery = baseQuery.where('attendance.employee_id', req.user.id);
    }

    // 🔹 Filters
    if (employeeId && req.user.role !== 'employee') {
      baseQuery.where('attendance.employee_id', employeeId);
    }

    if (startDate) {
      baseQuery.whereRaw(
        'DATE(attendance.check_in) >= ?',
        [startDate]
      );
    }

    if (endDate) {
      baseQuery.whereRaw(
        'DATE(attendance.check_in) <= ?',
        [endDate]
      );
    }

    if (status) {
      baseQuery.where('attendance.status', status);
    }

    // 🔹 Count query
    const countResult = await baseQuery
      .clone()
      .count('attendance.id as count')
      .first();

    const total = parseInt(countResult.count, 10) || 0;

    // 🔹 Data query
    const data = await baseQuery
      .clone()
      .select(
        'attendance.*',
        'employees.first_name',
        'employees.last_name',
        'employees.employee_id as employee_code',
        'attendance.hours_worked',
        'attendance.overtime_hours'
      )
      .orderBy('attendance.check_in', 'desc')
      .limit(limitNum)
      .offset(offset);

    res.json({
      success: true,
      count: total,
      pagination: {
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum)
      },
      data
    });
  } catch (error) {
    console.error('Get attendance logs error:', error);
    res.status(500).json({ message: 'Error fetching attendance logs' });
  }
};


// Create attendance override (company scoped)
const createOverride = async (req, res) => {
  const companyId = req.user.company_id;
  if (!companyId) {
    return res.status(400).json({ message: 'Company not assigned to user' });
  }

  const { attendanceId, employeeId, originalStatus, overriddenStatus, reason } = req.body;
  const userId = req.user.id;

  try {
    // Check permission
    if (!req.user.role || !['hr', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Not authorized to create overrides' });
    }

    // Verify attendance belongs to company
    const attendance = await knex('attendance')
      .where({ id: attendanceId, company_id: companyId })
      .first();

    if (!attendance) {
      return res.status(404).json({ message: 'Attendance record not found or access denied' });
    }

    const [override] = await knex('attendance_overrides')
      .insert({
        company_id: companyId,
        attendance_id: attendanceId,
        employee_id: employeeId,
        original_status: originalStatus || attendance.status,
        overridden_status: overriddenStatus,
        reason,
        requested_by: userId,
        approved_by: req.user.role === 'admin' ? userId : null,
        status: req.user.role === 'admin' ? 'approved' : 'pending'
      })
      .returning('*');

    // If admin approved immediately
    if (override.status === 'approved') {
      await knex('attendance')
        .where('id', attendanceId)
        .update({ status: overriddenStatus });
    }

    // await logAudit('create_override', 'attendance_overrides', override.id, userId, {
    //   attendance_id: attendanceId,
    //   status: override.status
    // });

    res.status(201).json({
      success: true,
      override
    });
  } catch (error) {
    console.error('Create override error:', error);
    res.status(500).json({ message: 'Error creating attendance override' });
  }
};

// Process override (approve/reject) - company scoped
const processOverride = async (req, res) => {
  const companyId = req.user.company_id;
  if (!companyId) {
    return res.status(400).json({ message: 'Company not assigned to user' });
  }

  const { overrideId } = req.params;
  const { status, comment } = req.body;
  const userId = req.user.id;

  try {
    if (!req.user.role || !['hr', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Not authorized to process overrides' });
    }

    const override = await knex('attendance_overrides')
      .where({ id: overrideId, company_id: companyId })
      .first();

    if (!override) {
      return res.status(404).json({ message: 'Override not found or access denied' });
    }

    const [updatedOverride] = await knex('attendance_overrides')
      .where('id', overrideId)
      .update({
        status,
        approved_by: userId,
        reviewed_at: new Date(),
        comment
      })
      .returning('*');

    if (status === 'approved') {
      await knex('attendance')
        .where('id', override.attendance_id)
        .update({ status: override.overridden_status });
    }

    await logAudit(`override_${status}`, 'attendance_overrides', overrideId, userId, { status, comment });

    res.json({
      success: true,
      override: updatedOverride
    });
  } catch (error) {
    console.error('Process override error:', error);
    res.status(500).json({ message: 'Error processing override' });
  }
};

// Get employee attendance summary (company scoped)
const getEmployeeSummary = async (req, res) => {
  const companyId = req.user.company_id;
  if (!companyId) {
    return res.status(400).json({ message: 'Company not assigned to user' });
  }

  const { employeeId } = req.params;
  const { startDate, endDate } = req.query;

  // 🔒 Employee access control
  if (req.user.role === 'employee' && employeeId != req.user.id) {
    return res.status(403).json({ message: 'Access denied' });
  }

  try {
    // Verify employee belongs to company
    const employee = await knex('employees')
      .where({ id: employeeId, company_id: companyId })
      .first();

    if (!employee) {
      return res.status(404).json({ message: 'Employee not found or access denied' });
    }

    let query = knex('attendance')
      .where({ employee_id: employeeId, company_id: companyId });

    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      query = query.whereBetween('check_in', [start, end]);
    }

    const records = await query.orderBy('check_in', 'desc');

    const summary = {
      total_days: records.length,
      present_days: records.filter(r => r.status === 'present').length,
      half_days: records.filter(r => r.status === 'half').length,
      absent_days: records.filter(r => r.status === 'absent').length,
      total_hours: records.reduce((sum, r) => sum + (r.hours_worked || 0), 0),
      total_overtime: records.reduce((sum, r) => sum + (r.overtime_hours || 0), 0),
      average_hours_per_day: records.length > 0 
        ? records.reduce((sum, r) => sum + (r.hours_worked || 0), 0) / records.length 
        : 0,
      recent_records: records.slice(0, 5)
    };

    res.json({
      success: true,
      summary
    });
  } catch (error) {
    console.error('Get employee summary error:', error);
    res.status(500).json({ message: 'Error generating attendance summary' });
  }
};

const getOverrides = async (req, res) => {
  const companyId = req.user.company_id;
  const { employeeId } = req.query; // optional filter by employee

  if (!companyId) {
    return res.status(400).json({ message: 'Company not assigned to user' });
  }

  try {
    // Check permission
    if (!req.user.role || !['hr', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Not authorized to view overrides' });
    }

    // Step 1: Get overrides
    let query = knex('attendance_overrides')
      .where({ company_id: companyId })
      .orderBy('created_at', 'desc');

    if (employeeId) {
      query = query.andWhere({ employee_id: employeeId });
    }

    const overrides = await query.select(
      'id',
      'attendance_id',
      'employee_id',
      'original_status',
      'overridden_status',
      'reason',
      'requested_by',
      'approved_by',
      'status',
      'created_at',
      'updated_at'
    );

    if (!overrides.length) {
      return res.status(404).json({ message: 'No overrides found' });
    }

    // Step 2: Get employee codes for all employee_ids in overrides
    const employeeIds = overrides.map(o => o.employee_id);
    const employees = await knex('employees')
      .whereIn('id', employeeIds)
      .select('id', 'employee_id');

    const employeeMap = {};
    employees.forEach(emp => {
      employeeMap[emp.id] = emp.employee_id;
    });

    // Step 3: Attach employee_code to each override
    const overridesWithCode = overrides.map(o => ({
      ...o,
      employee_id: employeeMap[o.employee_id] || null
    }));

    res.status(200).json({ success: true, overrides: overridesWithCode });
  } catch (error) {
    console.error('Get overrides error:', error);
    res.status(500).json({ message: 'Error fetching attendance overrides' });
  }
};

// Helper functions

const getEmployeeShift = async (employeeId, companyId) => {
  const employee = await knex('employees')
    .leftJoin('shifts', 'employees.shift_id', 'shifts.id')
    .where('employees.id', employeeId)
    .where('employees.company_id', companyId)
    .first();
  
  return employee;
};

const determineShiftType = (checkInTime, employeeShift) => {
  if (!employeeShift || !employeeShift.shift_id) {
    // Default logic if no shift assigned
    const hour = checkInTime.getHours();
    if (hour >= 6 && hour < 14) return 'Morning';
    if (hour >= 14 && hour < 22) return 'Afternoon';
    return 'Night';
  }
  
  // Use assigned shift
  return employeeShift.name;
};

async function verifyFace(employeeId, imageData) {
  // TODO: Implement actual facial recognition
  // For now, always return true
  return true;
}

async function saveImage(imageFile) {
  // If imageFile is a multer file object, return the path
  if (imageFile && imageFile.path) {
    // Get the relative path from the uploads directory
    const fullPath = imageFile.path;
    const uploadsIndex = fullPath.indexOf('uploads');
    if (uploadsIndex !== -1) {
      // Extract everything from 'uploads' onwards and prepend with /
      const relativePath = fullPath.substring(uploadsIndex);
      return `/${relativePath}`;
    }
    // Fallback: just return the path as is
    return fullPath;
  }
  return null;
}

module.exports = {
  checkIn,
  checkOut,
  getAttendanceLogs,
  createOverride,
  processOverride,
  getEmployeeSummary,
  getOverrides,
  getEmployeeShift,
  determineShiftType
};
