// src/controllers/attendanceController.js
const knex = require('../db/db');
const { getIo } = require('../socket');
const { hasAnyRole } = require('../middleware/authMiddleware');
const { doCheckIn, doCheckOut } = require('../services/attendance.service');
const { getEmployeeShift } = require('../utils/shift.util');
const { reverseGeocodeGoogle } = require('../services/googleGeocode');

// Resolve the real employees.id for the logged-in user.
// - employee login: req.user.id already points to employees.id
// - admin login: req.user.id points to users.id, so map by email + company
const resolveAttendanceEmployeeId = async (req) => {
  const companyId = Number(req.user?.company_id);
  if (!companyId) {
    throw new Error('Company not assigned to user');
  }

  // Employee token path (already employees.id)
  if (req.user?.type === 'employee') {
    const employee = await knex('employees')
      .where({ id: Number(req.user.id), company_id: companyId })
      .first();
    if (employee) return Number(employee.id);
  }

  // Admin token path (users.id -> employees.id by email)
  if (req.user?.type === 'admin' && req.user?.email) {
    const employee = await knex('employees')
      .where('company_id', companyId)
      .whereRaw('LOWER(email) = ?', [String(req.user.email).toLowerCase().trim()])
      .first();
    if (employee) return Number(employee.id);
  }

  // Last fallback: try req.user.id directly as employee id
  const fallbackEmployee = await knex('employees')
    .where({ id: Number(req.user?.id), company_id: companyId })
    .first();
  if (fallbackEmployee) return Number(fallbackEmployee.id);

  throw new Error('Employee profile not found for this account');
};

const getDayWindow = (date = new Date()) => {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  return { start, end };
};

const normalizeRequestedTime = (value) => {
  const normalized = String(value || '').trim();
  if (!normalized) return null;
  const match = normalized.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = match[3] ? Number(match[3]) : 0;

  if (hours > 23 || minutes > 59 || seconds > 59) return null;

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

const buildDateTime = (date, time) => `${date} ${time}`;

const calculateWorkedHours = (date, checkInTime, checkOutTime) => {
  const checkInDate = new Date(`${date}T${checkInTime}`);
  const checkOutDate = new Date(`${date}T${checkOutTime}`);

  if (Number.isNaN(checkInDate.getTime()) || Number.isNaN(checkOutDate.getTime())) {
    return null;
  }

  if (checkOutDate <= checkInDate) {
    checkOutDate.setDate(checkOutDate.getDate() + 1);
  }

  return Math.max(0, (checkOutDate - checkInDate) / (1000 * 60 * 60));
};

const buildAttendanceOverrideUpdate = ({ override, date }) => {
  const requestedCheckIn = normalizeRequestedTime(override.requested_check_in);
  const requestedCheckOut = normalizeRequestedTime(override.requested_check_out);
  const updatePayload = {
    status: override.overridden_status
  };

  if (requestedCheckIn) {
    updatePayload.check_in = buildDateTime(date, requestedCheckIn);
  }

  if (requestedCheckOut) {
    updatePayload.check_out = buildDateTime(date, requestedCheckOut);
  }

  if (requestedCheckIn && requestedCheckOut) {
    const workedHours = calculateWorkedHours(date, requestedCheckIn, requestedCheckOut);
    if (workedHours !== null) {
      updatePayload.hours_worked = workedHours;
      updatePayload.overtime_hours = 0;
    }
  }

  return updatePayload;
};

const getAttendanceDate = (attendance, fallbackDate) => {
  if (fallbackDate) return fallbackDate;
  if (!attendance?.check_in) return null;
  return new Date(attendance.check_in).toISOString().slice(0, 10);
};

// Check current attendance status
const getAttendanceStatus = async (req, res) => {
  try {
    const companyId = Number(req.user.company_id);
    const employeeId = await resolveAttendanceEmployeeId(req);

    const { start: todayStart, end: tomorrowStart } = getDayWindow();

    const activeAttendance = await knex('attendance')
      .where('employee_id', employeeId)
      .where('company_id', companyId)
      .where('check_in', '>=', todayStart)
      .where('check_in', '<', tomorrowStart)
      .whereNull('check_out')
      .first();

    const todayAttendance = await knex('attendance')
      .where('employee_id', employeeId)
      .where('company_id', companyId)
      .where('check_in', '>=', todayStart)
      .where('check_in', '<', tomorrowStart)
      .orderBy('check_in', 'desc')
      .limit(2);

    res.json({
      success: true,
      isCheckedIn: !!activeAttendance,
      hasCheckedInToday: todayAttendance.some((record) => Boolean(record.check_in)),
      todayRecords: todayAttendance || []
    });
  } catch (error) {
    console.error('Error fetching attendance status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch attendance status'
    });
  }
};

// Check-in employee
// const checkIn = async (req, res) => {
//   const companyId = req.user.company_id;
//   if (!companyId) {
//     return res.status(400).json({ message: 'Company not assigned to user' });
//   }

//   // Handle FormData - get fields from req.body and file from req.file
//   const employeeId = req.body.employeeId;
//   const imageData = req.file; // For FormData, file comes from req.file
//   const location = req.body.location ? JSON.parse(req.body.location) : null;
//   const deviceInfo = req.body.deviceInfo;
//   const userId = req.user.id;

//   try {
//     // Verify employee belongs to same company
//     const employee = await knex('employees')
//       .where({ id: employeeId, company_id: companyId })
//       .first();

//     if (!employee) {
//       return res.status(404).json({ message: 'Employee not found or access denied' });
//     }

//     // Verify face if image data is provided
//     if (imageData) {
//       const faceMatch = await verifyFace(employeeId, imageData);
//       if (!faceMatch) {
//         return res.status(400).json({ message: 'Face verification failed' });
//       }
//     }

//     // Check if already checked in today
//     const today = new Date();
//     today.setHours(0, 0, 0, 0);

//     const existingCheckIn = await knex('attendance')
//       .where('employee_id', employeeId)
//       .where('company_id', companyId)
//       .where('check_in', '>=', today)
//       .whereNull('check_out')
//       .first();

//     if (existingCheckIn) {
//       return res.status(400).json({ message: 'Already checked in today' });
//     }

//     // Get employee shift information
//     const employeeShift = await getEmployeeShift(employeeId, companyId);

//     // Determine shift type
//     const shiftType = determineShiftType(new Date(), employeeShift);

//     // Create attendance record
//     const [attendance] = await knex('attendance')
//       .insert({
//         company_id: companyId, // ← Company isolation
//         employee_id: employeeId,
//         check_in: new Date(),
//         check_in_location: location ? JSON.stringify(location) : null,
//         check_in_image_url: imageData ? await saveImage(imageData) : null,
//         device_info: deviceInfo || 'Web',
//         status: 'present',
//         shift_type: shiftType,
//         shift_id: employeeShift?.shift_id || null
//       })
//       .returning('*');

//     // Log check-in
//     // await logAudit('check_in', 'attendance', attendance.id, userId, {
//     //   employee_id: employeeId,
//     //   check_in: attendance.check_in
//     // });

//     res.status(201).json({
//       success: true,
//       message: 'Checked in successfully',
//       attendance
//     });
//   } catch (error) {
//     console.error('Check-in error:', error);
//     res.status(500).json({ message: 'Error processing check-in' });
//   }
// };

// // Check-out employee
// const checkOut = async (req, res) => {
//   const companyId = req.user.company_id;
//   if (!companyId) {
//     return res.status(400).json({ message: 'Company not assigned to user' });
//   }

//   // Handle FormData - get fields from req.body and file from req.file
//   const imageData = req.file; // For FormData, file comes from req.file
//   const location = req.body.location ? JSON.parse(req.body.location) : null;
//   const deviceInfo = req.body.deviceInfo;
//   const employeeId = req.user.id;

//   try {
//     // Find today's active check-in for this employee in company
//     const checkInRecord = await knex('attendance')
//       .where({
//         employee_id: employeeId,
//         company_id: companyId
//       })
//       .whereNull('check_out')
//       .whereRaw('DATE(check_in) = CURDATE()')
//       .first();

//     if (!checkInRecord) {
//       return res.status(400).json({ message: 'No active check-in found for today' });
//     }

//     // Get employee shift information for overtime calculation
//     const employeeShift = await getEmployeeShift(employeeId, companyId);

//     // Face verification (optional)
//     if (imageData) {
//       const faceMatch = await verifyFace(employeeId, imageData);
//       if (!faceMatch) {
//         return res.status(400).json({ message: 'Face verification failed' });
//       }
//     }

//     // Calculate hours based on shift
//     const checkOutTime = new Date();
//     const checkInTime = new Date(checkInRecord.check_in);
//     let hoursWorked = (checkOutTime - checkInTime) / (1000 * 60 * 60);

//     // Ensure minimum of 1 minute worked if check-out is same as check-in
//     if (hoursWorked < 0.0167) { // Less than 1 minute
//       hoursWorked = 0.0167; // Set to 1 minute
//     }

//     console.log('Hours calculation debug:', {
//       checkOutTime: checkOutTime.toISOString(),
//       checkInTime: checkInTime.toISOString(),
//       hoursWorked: hoursWorked,
//       checkInRecord: checkInRecord
//     });

//     // Use shift duration for standard hours if available, otherwise default to 8
//     let standardHours = 8;
//     if (employeeShift && employeeShift.start_time && employeeShift.end_time) {
//       const [startHour, startMin] = employeeShift.start_time.split(':').map(Number);
//       const [endHour, endMin] = employeeShift.end_time.split(':').map(Number);
//       const startTime = new Date();
//       startTime.setHours(startHour, startMin, 0, 0);
//       const endTime = new Date();
//       endTime.setHours(endHour, endMin, 0, 0);

//       // Handle overnight shifts
//       if (endTime < startTime) {
//         endTime.setDate(endTime.getDate() + 1);
//       }

//       standardHours = (endTime - startTime) / (1000 * 60 * 60);
//     }

//     const overtimeHours = Math.max(0, hoursWorked - standardHours);

//     console.log('Final hours to save:', {
//       hoursWorked: hoursWorked,
//       overtimeHours: overtimeHours
//     });

//     // Update attendance
//     await knex('attendance')
//       .where('id', checkInRecord.id)
//       .update({
//         check_out: checkOutTime,
//         check_out_location: location ? JSON.stringify(location) : null,
//         check_out_image_url: imageData ? await saveImage(imageData) : null,
//         hours_worked: hoursWorked,
//         overtime_hours: overtimeHours,
//         device_info: deviceInfo || 'Web'
//       });

//     const updatedAttendance = await knex('attendance')
//       .where('id', checkInRecord.id)
//       .first();

//     // Audit log
//     // await logAudit(
//     //   'check_out',
//     //   'attendance',
//     //   updatedAttendance.id,
//     //   req.user.id,
//     //   {
//     //     employee_id: employeeId,
//     //     check_out: updatedAttendance.check_out,
//     //     hours_worked: updatedAttendance.hours_worked
//     //   }
//     // );

//     return res.json({
//       success: true,
//       message: 'Checked out successfully',
//       attendance: updatedAttendance
//     });

//   } catch (error) {
//     console.error('Check-out error:', error);
//     return res.status(500).json({ message: 'Error processing check-out' });
//   }
// };



const checkIn = async (req, res) => {
  try {
    // 1️⃣ Resolve employeeId + companyId from authenticated user context
    const employeeId = await resolveAttendanceEmployeeId(req);
    const companyId = Number(req.user?.company_id);

    // 2️⃣ Validate inputs
    if (!employeeId || !companyId) {
      return res.status(400).json({
        success: false,
        message: "Missing or invalid employeeId or companyId"
      });
    }

    console.log("Check-in called with:", { employeeId, companyId });

    // 3️⃣ Fetch shift if assigned. Do not block check-in when shift is missing
    // (e.g. admin users without shift assignment).
    const shift = await getEmployeeShift(employeeId, companyId);
    if (!shift) {
      console.warn("Check-in without assigned shift:", { employeeId, companyId });
    }

    // 4️⃣ Insert attendance record
    const attendance = await doCheckIn({
      employeeId: employeeId,
      companyId: companyId,
      imageData: req.file?.path || null,
      location: req.body.location ? JSON.parse(req.body.location) : null,
      deviceInfo: 'Web',
      shiftId: shift?.id || null,
      shiftType: 'regular'  // Use string that will be converted to numeric
    });

    // 5️⃣ Return success
    res.json({ success: true, attendance });

  } catch (err) {
    console.error("Check-in error:", err);
    const isDuplicateCheckIn = err.message === 'Already checked in today';
    res.status(isDuplicateCheckIn ? 400 : 500).json({
      success: false,
      message: isDuplicateCheckIn ? err.message : "Failed to check in",
      error: err.message
    });
  }
};


const checkOut = async (req, res) => {
  try {
    const employeeId = await resolveAttendanceEmployeeId(req);
    await doCheckOut({
      employeeId,
      companyId: req.user.company_id,
      imageData: req.file?.path || null,
      location: req.body.location ? JSON.parse(req.body.location) : null,
      deviceInfo: 'Web'
    });

    res.json({ success: true, message: 'Checked out successfully' });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};





// const getAttendanceLogs = async (req, res) => {
//   const companyId = req.user.company_id;
//   if (!companyId) {
//     return res.status(400).json({ message: 'Company not assigned to user' });
//   }

//   const {
//     employeeId,
//     startDate,
//     endDate,
//     status,
//     page = 1,
//     limit = 10
//   } = req.query;

//   const pageNum = parseInt(page, 10);
//   const limitNum = parseInt(limit, 10);
//   const offset = (pageNum - 1) * limitNum;

//   try {
//     let baseQuery = knex('attendance')
//       .leftJoin('employees', 'attendance.employee_id', 'employees.id')
//       .where('attendance.company_id', companyId);

//     // 🔐 ACCESS CONTROL
//     // Only ADMIN can see all employees
//     // Any user with type = 'employee' (manager/hr/finance/employee)
//     // can see ONLY their own attendance
//     if (req.user.type === 'employee' && req.user.role !== 'admin') {
//       baseQuery = baseQuery.where(
//         'attendance.employee_id',
//         req.user.id
//       );
//     }

//     // 🔹 Filters (ADMIN ONLY for employeeId)
//     if (employeeId && req.user.role === 'admin') {
//       baseQuery.where('attendance.employee_id', employeeId);
//     }

//     if (startDate) {
//       baseQuery.whereRaw(
//         'DATE(attendance.check_in) >= ?',
//         [startDate]
//       );
//     }

//     if (endDate) {
//       baseQuery.whereRaw(
//         'DATE(attendance.check_in) <= ?',
//         [endDate]
//       );
//     }

//     if (status) {
//       baseQuery.where('attendance.status', status);
//     }

//     // 🔹 Count query
//     const countResult = await baseQuery
//       .clone()
//       .count('attendance.id as count')
//       .first();

//     const total = parseInt(countResult.count, 10) || 0;

//     // 🔹 Data query
//     const data = await baseQuery
//       .clone()
//       .select(
//         'attendance.*',
//         'employees.first_name',
//         'employees.last_name',
//         'employees.employee_id as employee_code',
//         'attendance.hours_worked',
//         'attendance.overtime_hours'
//       )
//       .orderBy('attendance.check_in', 'desc')
//       .limit(limitNum)
//       .offset(offset);

//     res.json({
//       success: true,
//       count: total,
//       pagination: {
//         page: pageNum,
//         limit: limitNum,
//         totalPages: Math.ceil(total / limitNum)
//       },
//       data
//     });
//   } catch (error) {
//     console.error('Get attendance logs error:', error);
//     res.status(500).json({ message: 'Error fetching attendance logs' });
//   }
// };



// Create attendance override (company scoped)

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
    // ===============================
    // Get logged in user info
    // ===============================
    let loggedInUser = null;

    const hasCompanyWideAccess = hasAnyRole(req.user, ['admin', 'hr', 'finance', 'ceo', 'superadmin']);
    if (!hasCompanyWideAccess) {
      loggedInUser = await knex('employees')
        .where({ id: req.user.id, company_id: companyId })
        .first();

      if (!loggedInUser) {
        return res.status(403).json({ message: 'User not found' });
      }
    }

    // ===============================
    // Base query
    // ===============================
    let baseQuery = knex('attendance as a')
      .leftJoin('employees as e', 'a.employee_id', 'e.id')
      .where('a.company_id', companyId);

    // ===============================
    // Access Control
    // ===============================
    if (hasCompanyWideAccess) {
      // Admin → all employees, no restriction
    } else if (hasAnyRole(loggedInUser, ['manager'])) {
      // Manager → self + same department
      baseQuery.where(function () {
        this.where('e.department_id', loggedInUser.department_id)
          .orWhere('a.employee_id', loggedInUser.id);
      });
    } else {
      // Employee / HR / Finance → only self
      baseQuery.where('a.employee_id', loggedInUser.id);
    }

    // ===============================
    // Filters
    // ===============================
    if (employeeId && (hasCompanyWideAccess || hasAnyRole(loggedInUser, ['manager']))) {
      baseQuery.where('a.employee_id', employeeId);
    }

    if (startDate) {
      baseQuery.whereRaw('DATE(a.check_in) >= ?', [startDate]);
    }

    if (endDate) {
      baseQuery.whereRaw('DATE(a.check_in) <= ?', [endDate]);
    }

    if (status) {
      baseQuery.where('a.status', status);
    }

    // ===============================
    // Count query
    // ===============================
    const countResult = await baseQuery
      .clone()
      .count('a.id as count')
      .first();

    const total = parseInt(countResult.count, 10) || 0;

    // ===============================
    // Data query
    // ===============================
    const data = await baseQuery
      .clone()
      .select(
        'a.*',
        'e.first_name',
        'e.last_name',
        'e.employee_id as employee_code',
        'a.hours_worked',
        'a.overtime_hours'
      )
      .orderBy('a.check_in', 'desc')
      .limit(limitNum)
      .offset(offset);

    // ===============================
    // Response
    // ===============================
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

// Get employee monthly attendance for payroll (company scoped)
const getAttendanceByEmployeeAndMonth = async (req, res) => {
  const companyId = req.user.company_id;
  if (!companyId) {
    return res.status(400).json({ message: 'Company not assigned to user' });
  }

  const { employeeId, month } = req.params;
  if (!employeeId || !month) {
    return res.status(400).json({ message: 'Employee and month are required' });
  }

  const match = String(month).match(/^(\d{4})-(\d{2})$/);
  if (!match) {
    return res.status(400).json({ message: 'Invalid month format. Expected YYYY-MM' });
  }

  const year = Number(match[1]);
  const monthNum = Number(match[2]);
  if (monthNum < 1 || monthNum > 12) {
    return res.status(400).json({ message: 'Invalid month value. Expected 01-12' });
  }

  const startDate = new Date(year, monthNum - 1, 1, 0, 0, 0, 0);
  const endDate = new Date(year, monthNum, 0, 23, 59, 59, 999);

  try {
    // Resolve employee by employee_id (code) first; fall back to numeric DB id.
    let employee = await knex('employees')
      .where({ employee_id: employeeId, company_id: companyId })
      .first();

    if (!employee && /^\d+$/.test(String(employeeId))) {
      employee = await knex('employees')
        .where({ id: Number(employeeId), company_id: companyId })
        .first();
    }

    if (!employee) {
      return res.status(404).json({ message: 'Employee not found or access denied' });
    }

    // 🔒 Access control: admin/hr/finance can view any; manager can view dept+self; others self only.
    if (!hasAnyRole(req.user, ['admin', 'hr', 'finance', 'ceo', 'superadmin'])) {
      const loggedInEmployee = await knex('employees')
        .where({ id: req.user.id, company_id: companyId })
        .first();

      if (!loggedInEmployee) {
        return res.status(403).json({ message: 'User not found' });
      }

      if (hasAnyRole(loggedInEmployee, ['manager'])) {
        const sameDepartment = employee.department_id && employee.department_id === loggedInEmployee.department_id;
        const isSelf = employee.id === loggedInEmployee.id;
        if (!sameDepartment && !isSelf) {
          return res.status(403).json({ message: 'Access denied' });
        }
      } else if (employee.id !== loggedInEmployee.id) {
        return res.status(403).json({ message: 'Access denied' });
      }
    }

    const attendance = await knex('attendance')
      .where({ employee_id: employee.id, company_id: companyId })
      .whereBetween('check_in', [startDate.toISOString(), endDate.toISOString()])
      .orderBy('check_in', 'asc');

    return res.json({
      success: true,
      attendance
    });
  } catch (error) {
    console.error('Get monthly attendance error:', error);
    return res.status(500).json({ message: 'Error fetching attendance' });
  }
};



const createOverride = async (req, res) => {
  const companyId = req.user.company_id;
  if (!companyId) {
    return res.status(400).json({ message: 'Company not assigned to user' });
  }

  const {
    attendanceId,
    employeeId,
    date,
    originalStatus,
    overriddenStatus,
    reason,
    requestedCheckIn,
    requestedCheckOut,
    leaveMode
  } = req.body;
  const userId = req.user.id;

  try {
    if (!reason || !String(reason).trim()) {
      return res.status(400).json({ message: 'Reason is required' });
    }

    if (!employeeId || !String(employeeId).trim()) {
      return res.status(400).json({ message: 'Employee ID is required' });
    }

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
      return res.status(400).json({ message: 'Valid date is required (YYYY-MM-DD)' });
    }

    const normalizedRequestedCheckIn = normalizeRequestedTime(requestedCheckIn);
    const normalizedRequestedCheckOut = normalizeRequestedTime(requestedCheckOut);
    const normalizedLeaveMode = String(leaveMode || 'none').toLowerCase();
    const isLeaveOverride =
      ['paid', 'half'].includes(normalizedLeaveMode) ||
      /^\[(Paid Leave|Half Day Leave)\s+-\s+/i.test(String(reason || '').trim());
    const requiresTimeUpdate = ['present', 'half', 'half_day'].includes(
      String(overriddenStatus || '').toLowerCase()
    ) && !isLeaveOverride;

    if (requiresTimeUpdate && (!normalizedRequestedCheckIn || !normalizedRequestedCheckOut)) {
      return res.status(400).json({
        message: 'Valid requested check-in and check-out times are required'
      });
    }

    let attendance = null;
    const normalizedEmployeeId = String(employeeId).trim();
    const employeeQuery = knex('employees')
      .where({ company_id: companyId })
      .andWhere((qb) => {
        qb.whereRaw('LOWER(employee_id) = LOWER(?)', [normalizedEmployeeId]);
        if (!Number.isNaN(Number(normalizedEmployeeId))) {
          qb.orWhere('id', Number(normalizedEmployeeId));
        }
      })
      .first();

    const employee = await employeeQuery;

    if (!employee) {
      return res.status(404).json({ message: 'Employee not found in this company' });
    }

    // Backward compatible path: use attendanceId when available
    if (attendanceId) {
      attendance = await knex('attendance')
        .where({ id: attendanceId, company_id: companyId, employee_id: employee.id })
        .first();
    }

    // Resolve attendance by employee + selected date
    if (!attendance) {
      attendance = await knex('attendance')
        .where({
          company_id: companyId,
          employee_id: employee.id
        })
        .whereRaw('DATE(check_in) = ?', [date])
        .orderBy('check_in', 'desc')
        .first();
    }

    // If no row exists for selected date, create a placeholder attendance row for that date.
    if (!attendance) {
      const seedStatus = (originalStatus || 'absent').toLowerCase();
      const insertedAttendance = await knex('attendance').insert({
        company_id: companyId,
        employee_id: employee.id,
        check_in: `${date} 00:00:00`,
        check_out: null,
        hours_worked: 0,
        overtime_hours: 0,
        status: seedStatus,
        device_info: 'Override',
        auto_flag: 0
      });

      const insertedAttendanceRaw = Array.isArray(insertedAttendance) ? insertedAttendance[0] : insertedAttendance;
      const insertedAttendanceId = typeof insertedAttendanceRaw === 'object'
        ? insertedAttendanceRaw.id
        : insertedAttendanceRaw;
      attendance = await knex('attendance')
        .where({ id: insertedAttendanceId, company_id: companyId })
        .first();
    }

    const isAutoApproved = hasAnyRole(req.user, ['admin', 'ceo', 'superadmin']);
    const insertedOverride = await knex('attendance_overrides').insert({
      company_id: companyId,
      attendance_id: attendance.id,
      employee_id: attendance.employee_id,
      original_status: originalStatus || attendance.status,
      overridden_status: overriddenStatus || attendance.status,
      reason,
      requested_check_in: normalizedRequestedCheckIn,
      requested_check_out: normalizedRequestedCheckOut,
      requested_by: userId,
      approved_by: isAutoApproved ? userId : null,
      status: isAutoApproved ? 'approved' : 'pending'
    });

    const insertedOverrideRaw = Array.isArray(insertedOverride) ? insertedOverride[0] : insertedOverride;
    const insertedOverrideId = typeof insertedOverrideRaw === 'object'
      ? insertedOverrideRaw.id
      : insertedOverrideRaw;
    const override = await knex('attendance_overrides')
      .where({ id: insertedOverrideId, company_id: companyId })
      .first();

    // If admin approved immediately
    if (override && override.status === 'approved') {
      const attendanceDate = getAttendanceDate(attendance, date);
      const updatePayload = buildAttendanceOverrideUpdate({
        override,
        date: attendanceDate
      });

      await knex('attendance')
        .where('id', attendance.id)
        .update(updatePayload);
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
  const { status } = req.body;
  const comment = req.body.comment ?? req.body.remarks ?? null;
  const userId = req.user.id;

  try {
    // Business rule: only admin/ceo/superadmin can approve or reject overrides.
    if (!hasAnyRole(req.user, ['admin', 'ceo', 'superadmin'])) {
      return res.status(403).json({ message: 'Not authorized to process overrides' });
    }

    if (!['approved', 'rejected'].includes(String(status || '').toLowerCase())) {
      return res.status(400).json({ message: 'Invalid status. Expected approved or rejected' });
    }

    const override = await knex('attendance_overrides')
      .where({ id: overrideId, company_id: companyId })
      .first();

    if (!override) {
      return res.status(404).json({ message: 'Override not found or access denied' });
    }

    if (String(override.status || '').toLowerCase() !== 'pending') {
      return res.status(400).json({ message: 'Only pending overrides can be processed' });
    }

    await knex('attendance_overrides')
      .where('id', overrideId)
      .update({
        status,
        approved_by: userId,
        reviewed_at: new Date(),
        comment
      });

    const updatedOverride = await knex('attendance_overrides')
      .where({ id: overrideId, company_id: companyId })
      .first();

    if (status === 'approved') {
      const attendance = await knex('attendance')
        .where({ id: override.attendance_id, company_id: companyId })
        .first();

      if (!attendance) {
        return res.status(404).json({ message: 'Attendance record not found for this override' });
      }

      const attendanceDate = getAttendanceDate(attendance);
      const updatePayload = buildAttendanceOverrideUpdate({
        override,
        date: attendanceDate
      });

      await knex('attendance')
        .where('id', override.attendance_id)
        .update(updatePayload);
    }

    // await logAudit(`override_${status}`, 'attendance_overrides', overrideId, userId, { status, comment });

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
  if (hasAnyRole(req.user, ['employee']) && !hasAnyRole(req.user, ['manager', 'hr', 'admin', 'ceo', 'superadmin']) && employeeId != req.user.id) {
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
    const canViewAllOverrides = hasAnyRole(req.user, ['manager', 'hr', 'admin', 'ceo', 'superadmin']);
    const viewerEmployeeId = canViewAllOverrides ? null : await resolveAttendanceEmployeeId(req);

    // Step 1: Get overrides
    let query = knex('attendance_overrides')
      .where({ company_id: companyId })
      .orderBy('created_at', 'desc');

    if (canViewAllOverrides) {
      if (employeeId) {
        query = query.andWhere({ employee_id: employeeId });
      }
    } else {
      // Employee-level users can see only their own override requests.
      query = query.andWhere({ employee_id: viewerEmployeeId });
    }

    const overrides = await query.select(
      'id',
      'attendance_id',
      'employee_id',
      'original_status',
      'overridden_status',
      'reason',
      'requested_check_in',
      'requested_check_out',
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

    // Step 3: Resolve override date from attendance record
    const attendanceIds = overrides.map(o => o.attendance_id).filter(Boolean);
    const attendanceRecords = attendanceIds.length
      ? await knex('attendance')
        .where({ company_id: companyId })
        .whereIn('id', attendanceIds)
        .select('id', 'check_in')
      : [];

    const attendanceDateMap = {};
    attendanceRecords.forEach((record) => {
      attendanceDateMap[record.id] = record.check_in
        ? new Date(record.check_in).toISOString().split('T')[0]
        : null;
    });

    // Step 4: Resolve requester/approver names (employees first, users fallback)
    const actorIds = [
      ...new Set(
        overrides
          .flatMap((o) => [o.requested_by, o.approved_by])
          .filter((id) => id !== null && id !== undefined)
      )
    ];

    const actorEmployeeRows = actorIds.length
      ? await knex('employees')
        .where({ company_id: companyId })
        .whereIn('id', actorIds)
        .select('id', 'first_name', 'last_name')
      : [];

    const actorUserRows = actorIds.length
      ? await knex('users')
        .whereIn('id', actorIds)
        .select('id', 'name')
      : [];

    const actorEmployeeNameMap = {};
    actorEmployeeRows.forEach((row) => {
      actorEmployeeNameMap[row.id] = `${row.first_name || ''} ${row.last_name || ''}`.trim();
    });

    const actorUserNameMap = {};
    actorUserRows.forEach((row) => {
      actorUserNameMap[row.id] = row.name || null;
    });

    const resolveActorName = (actorId) => {
      if (!actorId) return null;
      return actorEmployeeNameMap[actorId] || actorUserNameMap[actorId] || null;
    };

    // Step 5: Attach employee code + override date + actor names
    const overridesWithCode = overrides.map(o => ({
      ...o,
      employee_id: employeeMap[o.employee_id] || null,
      override_date: attendanceDateMap[o.attendance_id] || null,
      requested_by_name: resolveActorName(o.requested_by),
      approved_by_name: resolveActorName(o.approved_by)
    }));

    res.status(200).json({ success: true, overrides: overridesWithCode });
  } catch (error) {
    console.error('Get overrides error:', error);
    res.status(500).json({ message: 'Error fetching attendance overrides' });
  }
};

const postLiveLocation = async (req, res) => {
  try {
    const companyId = Number(req.user?.company_id);
    const employeeId = await resolveAttendanceEmployeeId(req);
    const latitude = Number(req.body?.latitude);
    const longitude = Number(req.body?.longitude);
    const accuracy = req.body?.accuracy != null ? Number(req.body.accuracy) : null;

    if (!companyId || !employeeId) {
      return res.status(400).json({ success: false, message: 'Missing employee or company context' });
    }

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return res.status(400).json({ success: false, message: 'Valid latitude and longitude are required' });
    }

    const timestampValue = req.body?.timestamp ? new Date(req.body.timestamp) : new Date();
    const locationTimestamp = Number.isNaN(timestampValue.getTime()) ? new Date() : timestampValue;

    const insertPayload = {
      employee_id: employeeId,
      company_id: companyId,
      latitude,
      longitude,
      accuracy: Number.isFinite(accuracy) ? accuracy : null,
      address: req.body?.address || null,
      location_data: JSON.stringify({
        timestamp: locationTimestamp.toISOString(),
        source: req.body?.source || 'web',
      }),
      is_tracking: true,
      tracking_status: 'active',
      device_info: req.body?.device_info || req.body?.deviceInfo || 'web',
      session_id: req.body?.session_id || null,
      location_timestamp: locationTimestamp,
      last_updated: knex.fn.now(),
    };

    const inserted = await knex('employee_live_locations').insert(insertPayload);
    const insertedRaw = Array.isArray(inserted) ? inserted[0] : inserted;
    const insertedId = typeof insertedRaw === 'object' ? insertedRaw.id : insertedRaw;

    const location = await knex('employee_live_locations')
      .where({ id: insertedId, company_id: companyId })
      .first();

    if (location) {
      const employee = await knex('employees')
        .where({ id: employeeId, company_id: companyId })
        .first('first_name', 'last_name', 'employee_id');

      const io = getIo();
      if (io) {
        io.to(`company:${companyId}`).emit('location:update', {
          ...location,
          employeeName: employee
            ? `${employee.first_name || ''} ${employee.last_name || ''}`.trim()
            : undefined,
          employee_code: employee?.employee_id || null,
          tracking_status: 'active',
          minutes_since_update: 0,
        });
      }
    }

    return res.status(201).json({
      success: true,
      message: 'Live location saved',
      location,
    });
  } catch (error) {
    console.error('Post live location error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to save live location',
    });
  }
};

const getLiveLocations = async (req, res) => {
  try {
    const companyId = Number(req.user?.company_id);
    if (!companyId) {
      return res.status(400).json({ success: false, message: 'Company not assigned to user' });
    }

    const latestLocationSubquery = knex('employee_live_locations as ell')
      .select('ell.employee_id')
      .max('ell.location_timestamp as latest_timestamp')
      .where('ell.company_id', companyId)
      .groupBy('ell.employee_id')
      .as('latest_locations');

    const locations = await knex('employee_live_locations as ell')
      .join(latestLocationSubquery, function () {
        this.on('ell.employee_id', '=', 'latest_locations.employee_id')
          .andOn('ell.location_timestamp', '=', 'latest_locations.latest_timestamp');
      })
      .leftJoin('employees as e', 'ell.employee_id', 'e.id')
      .where('ell.company_id', companyId)
      .select(
        'ell.id',
        'ell.employee_id',
        'ell.latitude',
        'ell.longitude',
        'ell.accuracy',
        'ell.address',
        'ell.location_timestamp',
        'ell.last_updated',
        'ell.device_info',
        'ell.tracking_status',
        'ell.is_tracking',
        'e.first_name',
        'e.last_name',
        'e.employee_id as employee_code'
      )
      .orderBy('ell.location_timestamp', 'desc');

    const now = Date.now();
    const enrichedLocations = locations.map((location) => {
      const timestamp = location.location_timestamp ? new Date(location.location_timestamp) : null;
      const minutesSinceUpdate =
        timestamp && !Number.isNaN(timestamp.getTime())
          ? Math.max(0, Math.round((now - timestamp.getTime()) / 60000))
          : null;

      let computedTrackingStatus = String(location.tracking_status || '').toLowerCase() || 'offline';
      if (minutesSinceUpdate !== null) {
        if (minutesSinceUpdate <= 5) {
          computedTrackingStatus = 'active';
        } else if (minutesSinceUpdate <= 15) {
          computedTrackingStatus = 'idle';
        } else {
          computedTrackingStatus = 'offline';
        }
      }

      return {
        ...location,
        tracking_status: computedTrackingStatus,
        minutes_since_update: minutesSinceUpdate,
      };
    });

    return res.json({
      success: true,
      locations: enrichedLocations,
    });
  } catch (error) {
    console.error('Get live locations error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch live locations',
    });
  }
};

const getLiveLocationHistory = async (req, res) => {
  try {
    const companyId = Number(req.user?.company_id);
    const requestedEmployeeId = Number(req.params?.employeeId);

    if (!companyId) {
      return res.status(400).json({ success: false, message: 'Company not assigned to user' });
    }

    if (!Number.isFinite(requestedEmployeeId)) {
      return res.status(400).json({ success: false, message: 'Valid employee id is required' });
    }

    let loggedInUser = null;
    const hasCompanyWideAccess = hasAnyRole(req.user, ['admin', 'hr', 'finance', 'ceo', 'superadmin']);

    if (!hasCompanyWideAccess) {
      loggedInUser = await knex('employees')
        .where({ id: req.user.id, company_id: companyId })
        .first();

      if (!loggedInUser) {
        return res.status(403).json({ success: false, message: 'User not found' });
      }

      if (hasAnyRole(loggedInUser, ['manager'])) {
        const requestedEmployee = await knex('employees')
          .where({ id: requestedEmployeeId, company_id: companyId })
          .first();

        if (!requestedEmployee) {
          return res.status(404).json({ success: false, message: 'Employee not found' });
        }

        if (requestedEmployee.id !== loggedInUser.id && requestedEmployee.department_id !== loggedInUser.department_id) {
          return res.status(403).json({ success: false, message: 'Not allowed to view this employee history' });
        }
      } else if (requestedEmployeeId !== loggedInUser.id) {
        return res.status(403).json({ success: false, message: 'Not allowed to view this employee history' });
      }
    }

    const {
      startDate,
      endDate,
      sessionId,
      limit = 500,
      stayRadiusMeters = 60,
      minimumStayMinutes = 5,
    } = req.query;

    const employee = await knex('employees')
      .where({ id: requestedEmployeeId, company_id: companyId })
      .first('id', 'first_name', 'last_name', 'employee_id');

    if (!employee) {
      return res.status(404).json({ success: false, message: 'Employee not found' });
    }

    let historyQuery = knex('employee_live_locations as ell')
      .where({
        'ell.company_id': companyId,
        'ell.employee_id': requestedEmployeeId,
      });

    if (startDate) {
      historyQuery = historyQuery.where('ell.location_timestamp', '>=', new Date(startDate));
    }

    if (endDate) {
      historyQuery = historyQuery.where('ell.location_timestamp', '<=', new Date(endDate));
    }

    if (sessionId) {
      historyQuery = historyQuery.where('ell.session_id', String(sessionId));
    }

    const pointLimit = Math.min(Math.max(Number(limit) || 500, 1), 2000);

    const points = await historyQuery
      .clone()
      .select(
        'ell.id',
        'ell.employee_id',
        'ell.latitude',
        'ell.longitude',
        'ell.accuracy',
        'ell.address',
        'ell.location_timestamp',
        'ell.device_info',
        'ell.session_id',
        'ell.tracking_status',
        'ell.is_tracking'
      )
      .orderBy('ell.location_timestamp', 'asc')
      .limit(pointLimit);

    const pointsWithAddresses = await Promise.all(
      points.slice(0, 10).map(async (point) => {
        if (point.address) return point;
        try {
          const reverseGeocoded = await reverseGeocodeGoogle({
            latitude: Number(point.latitude),
            longitude: Number(point.longitude),
          });
          return { ...point, address: reverseGeocoded?.address || null };
        } catch (error) {
          console.error('Reverse geocoding failed for point:', point.id, error);
          return point;
        }
      })
    );

    const finalPoints = [...pointsWithAddresses, ...points.slice(10)];

    const attendanceRecord = await knex('attendance as a')
      .where({
        'a.company_id': companyId,
        'a.employee_id': requestedEmployeeId,
      })
      .modify((qb) => {
        if (startDate) qb.where('a.check_in', '>=', new Date(startDate));
        if (endDate) qb.where('a.check_in', '<=', new Date(endDate));
      })
      .orderBy('a.check_in', 'desc')
      .first(
        'a.id',
        'a.check_in',
        'a.check_out',
        'a.check_in_location',
        'a.check_out_location',
        'a.hours_worked',
        'a.status'
      );

    const parseStoredLocation = (rawValue) => {
      if (!rawValue) return null;
      if (typeof rawValue === 'string') {
        try {
          return JSON.parse(rawValue);
        } catch {
          return null;
        }
      }
      return rawValue;
    };

    const formatCoordinateLabel = (latitude, longitude) => {
      const lat = Number(latitude);
      const lng = Number(longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    };

    const parsedCheckInLocation = parseStoredLocation(attendanceRecord?.check_in_location);
    const parsedCheckOutLocation = parseStoredLocation(attendanceRecord?.check_out_location);

    const haversineMeters = (lat1, lon1, lat2, lon2) => {
      const toRad = (deg) => (deg * Math.PI) / 180;
      const R = 6371000;
      const dLat = toRad(lat2 - lat1);
      const dLon = toRad(lon2 - lon1);
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) *
        Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
      return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };

    let totalDistanceMeters = 0;
    for (let i = 1; i < finalPoints.length; i += 1) {
      const prev = finalPoints[i - 1];
      const current = finalPoints[i];
      const prevLat = Number(prev.latitude);
      const prevLng = Number(prev.longitude);
      const currentLat = Number(current.latitude);
      const currentLng = Number(current.longitude);

      if (Number.isFinite(prevLat) && Number.isFinite(prevLng) && Number.isFinite(currentLat) && Number.isFinite(currentLng)) {
        totalDistanceMeters += haversineMeters(prevLat, prevLng, currentLat, currentLng);
      }
    }

    const startPoint = finalPoints[0] || null;
    const endPoint = finalPoints[finalPoints.length - 1] || null;
    const tripDurationMinutes =
      startPoint && endPoint
        ? Math.max(0, Math.round((new Date(endPoint.location_timestamp).getTime() - new Date(startPoint.location_timestamp).getTime()) / 60000))
        : 0;

    const normalizedStayRadiusMeters = Math.min(
      Math.max(Number(stayRadiusMeters) || 60, 20),
      250
    );
    const normalizedMinimumStayMinutes = Math.min(
      Math.max(Number(minimumStayMinutes) || 5, 1),
      240
    );

    const buildStaySegments = (routePoints) => {
      if (!Array.isArray(routePoints) || routePoints.length === 0) {
        return [];
      }

      const segments = [];
      let currentSegment = {
        points: [routePoints[0]],
        anchor: routePoints[0],
      };

      const flushSegment = () => {
        const segmentPoints = currentSegment.points;
        const firstPoint = segmentPoints[0];
        const lastPoint = segmentPoints[segmentPoints.length - 1];
        const startedAt = firstPoint?.location_timestamp
          ? new Date(firstPoint.location_timestamp)
          : null;
        const endedAt = lastPoint?.location_timestamp
          ? new Date(lastPoint.location_timestamp)
          : null;

        if (!startedAt || !endedAt) {
          return;
        }

        const durationMinutes = Math.max(
          0,
          Math.round((endedAt.getTime() - startedAt.getTime()) / 60000)
        );

        if (durationMinutes < normalizedMinimumStayMinutes) {
          return;
        }

        const avgLatitude =
          segmentPoints.reduce((sum, point) => sum + Number(point.latitude || 0), 0) /
          segmentPoints.length;
        const avgLongitude =
          segmentPoints.reduce((sum, point) => sum + Number(point.longitude || 0), 0) /
          segmentPoints.length;

        segments.push({
          startTime: firstPoint.location_timestamp || null,
          endTime: lastPoint.location_timestamp || null,
          durationMinutes,
          latitude: Number(avgLatitude.toFixed(6)),
          longitude: Number(avgLongitude.toFixed(6)),
          address:
            segmentPoints
              .map((point) => String(point.address || '').trim())
              .find(Boolean) ||
            formatCoordinateLabel(avgLatitude, avgLongitude),
          pointCount: segmentPoints.length,
        });
      };

      for (let index = 1; index < routePoints.length; index += 1) {
        const point = routePoints[index];
        const distanceFromAnchor = haversineMeters(
          Number(currentSegment.anchor.latitude),
          Number(currentSegment.anchor.longitude),
          Number(point.latitude),
          Number(point.longitude)
        );

        if (distanceFromAnchor <= normalizedStayRadiusMeters) {
          currentSegment.points.push(point);
          continue;
        }

        flushSegment();
        currentSegment = {
          points: [point],
          anchor: point,
        };
      }

      flushSegment();
      return segments;
    };

    const staySegments = buildStaySegments(finalPoints);
    const currentStay = staySegments.length
      ? staySegments[staySegments.length - 1]
      : null;
    const lastSeenAt = endPoint?.location_timestamp || null;
    const minutesSinceLastPing =
      lastSeenAt && !Number.isNaN(new Date(lastSeenAt).getTime())
        ? Math.max(0, Math.round((Date.now() - new Date(lastSeenAt).getTime()) / 60000))
        : null;

    return res.json({
      success: true,
      employee,
      points: finalPoints,
      summary: {
        pointCount: finalPoints.length,
        totalDistanceMeters: Number(totalDistanceMeters.toFixed(2)),
        tripDurationMinutes,
        startedAt: startPoint?.location_timestamp || attendanceRecord?.check_in || null,
        endedAt: endPoint?.location_timestamp || attendanceRecord?.check_out || null,
        stopCount: staySegments.length,
        stayRadiusMeters: normalizedStayRadiusMeters,
        minimumStayMinutes: normalizedMinimumStayMinutes,
        stops: staySegments,
        currentStay: currentStay || null,
        lastSeenAt,
        minutesSinceLastPing,
        startAddress:
          startPoint?.address ||
          parsedCheckInLocation?.address ||
          formatCoordinateLabel(parsedCheckInLocation?.latitude, parsedCheckInLocation?.longitude) ||
          null,
        endAddress:
          endPoint?.address ||
          parsedCheckOutLocation?.address ||
          formatCoordinateLabel(endPoint?.latitude, endPoint?.longitude) ||
          parsedCheckInLocation?.address ||
          formatCoordinateLabel(parsedCheckInLocation?.latitude, parsedCheckInLocation?.longitude) ||
          formatCoordinateLabel(parsedCheckOutLocation?.latitude, parsedCheckOutLocation?.longitude) ||
          null,
        attendance: attendanceRecord || null,
      },
    });
  } catch (error) {
    console.error('Get live location history error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch live location history',
    });
  }
};

// Helper functions



module.exports = {
  getAttendanceStatus,
  checkIn,
  checkOut,
  getAttendanceLogs,
  getAttendanceByEmployeeAndMonth,
  createOverride,
  processOverride,
  getEmployeeSummary,
  getOverrides,
  postLiveLocation,
  getLiveLocations,
  getLiveLocationHistory,
  //getEmployeeShift,
  //determineShiftTyp
};
