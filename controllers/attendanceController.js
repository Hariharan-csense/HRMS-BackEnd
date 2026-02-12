  // src/controllers/attendanceController.js
  const knex = require('../db/db');
  const { doCheckIn, doCheckOut } = require('../services/attendance.service');
  const { getEmployeeShift } = require('../utils/shift.util');

  // Check current attendance status
  const getAttendanceStatus = async (req, res) => {
    try {
      const employeeId = req.user.id;
      const companyId = req.user.company_id;
      
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const activeAttendance = await knex('attendance')
        .where('employee_id', employeeId)
        .where('company_id', companyId)
        .where('check_in', '>=', today)
        .whereNull('check_out')
        .first();

      const todayAttendance = await knex('attendance')
        .where('employee_id', employeeId)
        .where('company_id', companyId)
        .whereRaw('DATE(check_in) = CURDATE()')
        .orderBy('check_in', 'desc')
        .limit(2);

      res.json({
        success: true,
        isCheckedIn: !!activeAttendance,
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
      // 1️⃣ Get and cast employeeId and companyId
      const employeeId = Number(req.body.employeeId);
      const companyId = Number(req.user?.company_id);

      // 2️⃣ Validate inputs
      if (!employeeId || !companyId) {
        return res.status(400).json({
          success: false,
          message: "Missing or invalid employeeId or companyId"
        });
      }

      console.log("Check-in called with:", { employeeId, companyId });

      // 3️⃣ Fetch the employee's shift
      const shift = await getEmployeeShift(employeeId, companyId);

      if (!shift) {
        return res.status(400).json({
          success: false,
          message: "No active shift found for this employee"
        });
      }

      // 4️⃣ Insert attendance record
      const attendance = await doCheckIn({
        employeeId: employeeId,
        companyId: companyId,
        imageData: req.file?.path || null,
        location: req.body.location ? JSON.parse(req.body.location) : null,
        deviceInfo: 'Web',
        shiftId: shift.id,
        shiftType: 'regular'  // Use string that will be converted to numeric
      });

      // 5️⃣ Return success
      res.json({ success: true, attendance });

    } catch (err) {
      console.error("Check-in error:", err);
      res.status(500).json({
        success: false,
        message: "Failed to check in",
        error: err.message
      });
    }
  };


  const checkOut = async (req, res) => {
    try {
      await doCheckOut({
        employeeId: req.user.id,
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

    // Admin might not exist in employees table
    if (req.user.role !== 'admin') {
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
    if (req.user.role === 'admin') {
      // Admin → all employees, no restriction
    } else if (loggedInUser.role === 'manager') {
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
    if (employeeId && (req.user.role === 'admin' || loggedInUser?.role === 'manager')) {
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



  module.exports = {
    getAttendanceStatus,
    checkIn,
    checkOut,
    getAttendanceLogs,
    createOverride,
    processOverride,
    getEmployeeSummary,
    getOverrides,
    //getEmployeeShift,
    //determineShiftTyp
  };
