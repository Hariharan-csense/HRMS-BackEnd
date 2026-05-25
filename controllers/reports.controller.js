// controllers/reports.controller.js

const knex = require('../db/db'); // ← Fixed path (CommonJS require)

// Helper to get a safe report year from query input
const getYear = (req) => {
  const parsedYear = Number.parseInt(String(req.query.year || ''), 10);
  const currentYear = new Date().getFullYear();

  if (!Number.isInteger(parsedYear) || parsedYear < 2000 || parsedYear > currentYear + 5) {
    return currentYear;
  }

  return parsedYear;
};

const resolveCompanyId = async (req) => {
  let companyId = req.user?.company_id;

  if (!companyId && req.user?.email) {
    const employee = await knex('employees')
      .where({ email: req.user.email })
      .whereNotNull('company_id')
      .first('company_id');
    companyId = employee?.company_id || null;
  }

  return companyId || null;
};

const toDateKey = (value) => {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const addDays = (dateKey, days) => {
  const date = new Date(`${dateKey}T00:00:00`);
  date.setDate(date.getDate() + days);
  return toDateKey(date);
};

const isWeekendDateKey = (dateKey) => {
  if (!dateKey) return false;
  const date = new Date(`${dateKey}T00:00:00`);
  if (Number.isNaN(date.getTime())) return false;
  const day = date.getDay();
  return day === 0 || day === 6;
};

const clampDateRange = (fromDate, toDate, startDate, endDate) => {
  const from = toDateKey(fromDate);
  const to = toDateKey(toDate);
  if (!from || !to) return null;

  const start = startDate ? toDateKey(startDate) : from;
  const end = endDate ? toDateKey(endDate) : to;

  const clampedFrom = from > start ? from : start;
  const clampedTo = to < end ? to : end;

  if (clampedFrom > clampedTo) return null;
  return { from: clampedFrom, to: clampedTo };
};

const minutesBetweenTimes = (fromTime, toTime) => {
  if (!fromTime || !toTime) return 0;
  const [fromH, fromM] = String(fromTime).split(':').map(Number);
  const [toH, toM] = String(toTime).split(':').map(Number);
  if ([fromH, fromM, toH, toM].some(Number.isNaN)) return 0;
  return Math.max(0, (toH * 60 + toM) - (fromH * 60 + fromM));
};

const formatHoursFromMinutes = (minutes) => {
  if (!minutes) return '00:00:00';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
};

const normalizeStatus = (value) => String(value || '').toLowerCase().trim();

/* =========================
   ATTENDANCE REPORT
========================= */
// Updated getAttendanceReport function (replace in your reports.controller.js)

// Final Fixed getAttendanceReport (replace in reports.controller.js)

const getAttendanceReport = async (req, res) => {
  try {
    const companyId = await resolveCompanyId(req);
    const year = getYear(req); // fallback year when dates not provided

    if (!companyId) {
      return res.status(400).json({
        success: false,
        message: 'Company context missing for report generation',
      });
    }

    const {
      startDate,
      endDate,
      employeeId,
      departmentId,
      status,
    } = req.query;

    const attendanceHasCompanyId = await knex.schema.hasColumn('attendance', 'company_id');

    const applyCompanyScope = (query) => {
      if (attendanceHasCompanyId) {
        return query.where('a.company_id', companyId);
      }
      return query.where('e.company_id', companyId);
    };

    // ========= Base scoped query (for reuse) =========
    let base = knex('attendance as a')
      .leftJoin('employees as e', 'a.employee_id', 'e.id')
      .leftJoin('departments as d', 'e.department_id', 'd.id');

    base = applyCompanyScope(base);

    if (startDate) {
      base = base.whereRaw('DATE(a.check_in) >= ?', [startDate]);
    } else {
      // default to start of year if no range provided
      base = base.whereRaw('YEAR(a.check_in) = ?', [year]);
    }

    if (endDate) {
      base = base.whereRaw('DATE(a.check_in) <= ?', [endDate]);
    }

    if (employeeId) {
      // accept employee code or numeric id
      base = base.where(function (qb) {
        qb.where('e.employee_id', employeeId);
        if (/^\\d+$/.test(String(employeeId))) {
          qb.orWhere('e.id', Number(employeeId));
        }
      });
    }

    if (departmentId) {
      base = base.where('e.department_id', departmentId);
    }

    if (status) {
      base = base.where('a.status', status);
    }

    // ========= Detailed rows (for CSV/export) =========
    const attendanceRows = await base
      .clone()
      .select(
        'a.id',
        'e.id as employeePkId',
        'e.employee_id as employeeCode',
        knex.raw("CONCAT(COALESCE(e.first_name,''), ' ', COALESCE(e.last_name,'')) as employeeName"),
        'e.mobile as phoneNumber',
        'e.location_office as branch',
        'd.name as department',
        'desg.name as designation',
        'a.status',
        knex.raw("DATE_FORMAT(a.check_in, '%Y-%m-%d') as date"),
        knex.raw("TIME_FORMAT(a.check_in, '%H:%i:%s') as checkInTime"),
        knex.raw("TIME_FORMAT(a.check_out, '%H:%i:%s') as checkOutTime"),
        'a.hours_worked as hoursWorked',
        'a.overtime_hours as overtimeHours',
        'a.device_info as deviceInfo',
        'a.auto_flag as autoFlag',
        'a.flag_reason as flagReason',
        'a.check_in_location',
        'a.check_out_location'
      )
      .leftJoin('designations as desg', 'e.designation_id', 'desg.id')
      .orderBy('a.check_in', 'desc');

    const reportStartDate = startDate || `${year}-01-01`;
    const reportEndDate = endDate || `${year}-12-31`;

    const employeeScope = (query, employeeAlias = 'e') => {
      if (employeeId) {
        query.where(function () {
          this.where(`${employeeAlias}.employee_id`, employeeId);
          if (/^\d+$/.test(String(employeeId))) {
            this.orWhere(`${employeeAlias}.id`, Number(employeeId));
          }
        });
      }

      if (departmentId) {
        query.where(`${employeeAlias}.department_id`, departmentId);
      }

      return query;
    };

    let employeeQuery = knex('employees as e')
      .leftJoin('departments as d', 'e.department_id', 'd.id')
      .leftJoin('designations as desg', 'e.designation_id', 'desg.id')
      .where('e.company_id', companyId)
      .select(
        'e.id as employeePkId',
        'e.employee_id as employeeCode',
        knex.raw("CONCAT(COALESCE(e.first_name,''), ' ', COALESCE(e.last_name,'')) as employeeName"),
        'e.mobile as phoneNumber',
        'e.location_office as branch',
        'd.name as department',
        'desg.name as designation'
      );

    employeeQuery = employeeScope(employeeQuery);
    const scopedEmployees = await employeeQuery;

    const leaveHasCompanyId = await knex.schema.hasColumn('leave_applications', 'company_id');
    let leaveQuery = knex('leave_applications as l')
      .leftJoin('employees as e', 'l.employee_id', 'e.id')
      .leftJoin('departments as d', 'e.department_id', 'd.id')
      .leftJoin('designations as desg', 'e.designation_id', 'desg.id')
      .whereRaw('DATE(l.from_date) <= ?', [reportEndDate])
      .whereRaw('DATE(l.to_date) >= ?', [reportStartDate])
      .select(
        'l.id as leaveId',
        'l.application_id as leaveApplicationId',
        'l.employee_id as employeePkId',
        'e.employee_id as employeeCode',
        knex.raw("CONCAT(COALESCE(e.first_name,''), ' ', COALESCE(e.last_name,'')) as employeeName"),
        'e.mobile as phoneNumber',
        'e.location_office as branch',
        'd.name as department',
        'desg.name as designation',
        'l.leave_type_name as leaveType',
        knex.raw("DATE_FORMAT(l.from_date, '%Y-%m-%d') as leaveFromDate"),
        knex.raw("DATE_FORMAT(l.to_date, '%Y-%m-%d') as leaveToDate"),
        'l.days as leaveDays',
        'l.status as leaveStatus',
        'l.reason as leaveReason',
        'l.remarks as leaveRemarks'
      );

    leaveQuery = leaveHasCompanyId
      ? leaveQuery.where('l.company_id', companyId)
      : leaveQuery.where('e.company_id', companyId);
    leaveQuery = employeeScope(leaveQuery);

    const allLeaveApplications = await leaveQuery;
    const leaveApplications = allLeaveApplications.filter((leave) => normalizeStatus(leave.leaveStatus) === 'approved');

    let permissionQuery = knex('leave_permissions as p')
      .leftJoin('employees as e', 'p.employee_id', 'e.id')
      .leftJoin('departments as d', 'e.department_id', 'd.id')
      .leftJoin('designations as desg', 'e.designation_id', 'desg.id')
      .where('p.company_id', companyId)
      .whereRaw('DATE(p.permission_date) >= ?', [reportStartDate])
      .whereRaw('DATE(p.permission_date) <= ?', [reportEndDate])
      .select(
        'p.id as permissionId',
        'p.permission_id as permissionApplicationId',
        'p.employee_id as employeePkId',
        'e.employee_id as employeeCode',
        knex.raw("CONCAT(COALESCE(e.first_name,''), ' ', COALESCE(e.last_name,'')) as employeeName"),
        'e.mobile as phoneNumber',
        'e.location_office as branch',
        'd.name as department',
        'desg.name as designation',
        knex.raw("DATE_FORMAT(p.permission_date, '%Y-%m-%d') as permissionDate"),
        knex.raw("TIME_FORMAT(p.permission_time_from, '%H:%i:%s') as permissionFromTime"),
        knex.raw("TIME_FORMAT(p.permission_time_to, '%H:%i:%s') as permissionToTime"),
        'p.status as permissionStatus',
        'p.reason as permissionReason',
        'p.remarks as permissionRemarks'
      );

    permissionQuery = employeeScope(permissionQuery);

    const allPermissionApplications = await permissionQuery;
    const permissionApplications = allPermissionApplications.filter(
      (permission) => normalizeStatus(permission.permissionStatus) === 'approved'
    );

    const rowsByEmployeeDate = new Map();
    const rowKey = (employeePkId, date) => `${employeePkId || ''}-${toDateKey(date) || ''}`;

    const rows = attendanceRows.map((row) => {
      const normalized = {
        ...row,
        date: toDateKey(row.date),
        leaveTaken: '',
        leaveType: '',
        leaveDays: '',
        leaveReason: '',
        permissionTaken: '',
        permissionFromTime: '',
        permissionToTime: '',
        permissionDuration: '',
        permissionReason: '',
      };
      rowsByEmployeeDate.set(rowKey(normalized.employeePkId, normalized.date), normalized);
      return normalized;
    });

    leaveApplications.forEach((leave) => {
      const range = clampDateRange(
        leave.leaveFromDate,
        leave.leaveToDate,
        reportStartDate,
        reportEndDate
      );
      if (!range) return;

      for (let date = range.from; date <= range.to; date = addDays(date, 1)) {
        const key = rowKey(leave.employeePkId, date);
        const existing = rowsByEmployeeDate.get(key);

        if (existing) {
          existing.leaveTaken = 'Yes';
          existing.leaveType = leave.leaveType || '';
          existing.leaveDays = leave.leaveDays || '';
          existing.leaveReason = leave.leaveReason || leave.leaveRemarks || '';
          existing.checkInTime = null;
          existing.checkOutTime = null;
          existing.check_in_location = null;
          existing.check_out_location = null;
          existing.hoursWorked = 0;
          existing.overtimeHours = 0;
          existing.status = 'leave';
          continue;
        }

        const leaveRow = {
          id: `leave-${leave.leaveId}-${date}`,
          employeePkId: leave.employeePkId,
          employeeCode: leave.employeeCode,
          employeeName: leave.employeeName,
          phoneNumber: leave.phoneNumber,
          branch: leave.branch,
          department: leave.department,
          designation: leave.designation,
          status: 'leave',
          date,
          checkInTime: null,
          checkOutTime: null,
          hoursWorked: 0,
          overtimeHours: 0,
          deviceInfo: null,
          autoFlag: null,
          flagReason: leave.leaveReason || leave.leaveRemarks || '',
          check_in_location: null,
          check_out_location: null,
          leaveTaken: 'Yes',
          leaveType: leave.leaveType || '',
          leaveDays: leave.leaveDays || '',
          leaveReason: leave.leaveReason || leave.leaveRemarks || '',
          permissionTaken: '',
          permissionFromTime: '',
          permissionToTime: '',
          permissionDuration: '',
          permissionReason: '',
        };

        rowsByEmployeeDate.set(key, leaveRow);
        rows.push(leaveRow);
      }
    });

    permissionApplications.forEach((permission) => {
      const date = toDateKey(permission.permissionDate);
      if (!date) return;
      const key = rowKey(permission.employeePkId, date);
      const duration = formatHoursFromMinutes(
        minutesBetweenTimes(permission.permissionFromTime, permission.permissionToTime)
      );
      const existing = rowsByEmployeeDate.get(key);

      if (existing) {
        existing.permissionTaken = 'Yes';
        existing.permissionFromTime = permission.permissionFromTime || '';
        existing.permissionToTime = permission.permissionToTime || '';
        existing.permissionDuration = duration;
        existing.permissionReason = permission.permissionReason || permission.permissionRemarks || '';
        return;
      }

      const permissionRow = {
        id: `permission-${permission.permissionId}`,
        employeePkId: permission.employeePkId,
        employeeCode: permission.employeeCode,
        employeeName: permission.employeeName,
        phoneNumber: permission.phoneNumber,
        branch: permission.branch,
        department: permission.department,
        designation: permission.designation,
        status: 'permission',
        date,
        checkInTime: null,
        checkOutTime: null,
        hoursWorked: 0,
        overtimeHours: 0,
        deviceInfo: null,
        autoFlag: null,
        flagReason: permission.permissionReason || permission.permissionRemarks || '',
        check_in_location: null,
        check_out_location: null,
        leaveTaken: '',
        leaveType: '',
        leaveDays: '',
        leaveReason: '',
        permissionTaken: 'Yes',
        permissionFromTime: permission.permissionFromTime || '',
        permissionToTime: permission.permissionToTime || '',
        permissionDuration: duration,
        permissionReason: permission.permissionReason || permission.permissionRemarks || '',
      };

      rowsByEmployeeDate.set(key, permissionRow);
      rows.push(permissionRow);
    });

    if (!status || normalizeStatus(status) === 'weekend') {
      scopedEmployees.forEach((employee) => {
        for (let date = reportStartDate; date <= reportEndDate; date = addDays(date, 1)) {
          if (!isWeekendDateKey(date)) continue;

          const key = rowKey(employee.employeePkId, date);
          if (rowsByEmployeeDate.has(key)) continue;

          const weekendRow = {
            id: `weekend-${employee.employeePkId}-${date}`,
            employeePkId: employee.employeePkId,
            employeeCode: employee.employeeCode,
            employeeName: employee.employeeName,
            phoneNumber: employee.phoneNumber,
            branch: employee.branch,
            department: employee.department,
            designation: employee.designation,
            status: 'weekend',
            date,
            checkInTime: null,
            checkOutTime: null,
            hoursWorked: 0,
            overtimeHours: 0,
            deviceInfo: null,
            autoFlag: null,
            flagReason: 'Weekend',
            check_in_location: null,
            check_out_location: null,
            leaveTaken: '',
            leaveType: '',
            leaveDays: '',
            leaveReason: '',
            permissionTaken: '',
            permissionFromTime: '',
            permissionToTime: '',
            permissionDuration: '',
            permissionReason: '',
          };

          rowsByEmployeeDate.set(key, weekendRow);
          rows.push(weekendRow);
        }
      });
    }

    rows.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

    const leaveRows = allLeaveApplications.map((leave) => ({
      leaveApplicationId: leave.leaveApplicationId || leave.leaveId,
      employeePkId: leave.employeePkId,
      employeeCode: leave.employeeCode,
      employeeName: leave.employeeName,
      phoneNumber: leave.phoneNumber,
      branch: leave.branch,
      department: leave.department,
      designation: leave.designation,
      leaveType: leave.leaveType || '',
      leaveFromDate: toDateKey(leave.leaveFromDate),
      leaveToDate: toDateKey(leave.leaveToDate),
      leaveDays: leave.leaveDays || '',
      leaveStatus: leave.leaveStatus || '',
      leaveReason: leave.leaveReason || '',
      leaveRemarks: leave.leaveRemarks || '',
    }));

    const permissionRows = allPermissionApplications.map((permission) => ({
      permissionApplicationId: permission.permissionApplicationId || permission.permissionId,
      employeePkId: permission.employeePkId,
      employeeCode: permission.employeeCode,
      employeeName: permission.employeeName,
      phoneNumber: permission.phoneNumber,
      branch: permission.branch,
      department: permission.department,
      designation: permission.designation,
      permissionDate: toDateKey(permission.permissionDate),
      permissionFromTime: permission.permissionFromTime || '',
      permissionToTime: permission.permissionToTime || '',
      permissionDuration: formatHoursFromMinutes(
        minutesBetweenTimes(permission.permissionFromTime, permission.permissionToTime)
      ),
      permissionStatus: permission.permissionStatus || '',
      permissionReason: permission.permissionReason || '',
      permissionRemarks: permission.permissionRemarks || '',
    }));

    // ========= Monthly trend (respecting filters) =========
    const trendRaw = await base
      .clone()
      .whereNotNull('a.check_in')
      .select(
        knex.raw("DATE_FORMAT(a.check_in, '%Y-%m') as ym_key"),
        knex.raw("DATE_FORMAT(a.check_in, '%M') as month_name"),
        knex.raw("SUM(CASE WHEN a.status = 'present' THEN 1 ELSE 0 END) as present"),
        knex.raw("SUM(CASE WHEN a.status = 'absent' THEN 1 ELSE 0 END) as absent"),
        knex.raw("SUM(CASE WHEN a.status = 'half' THEN 1 ELSE 0 END) as half")
      )
      .groupByRaw("DATE_FORMAT(a.check_in, '%Y-%m'), DATE_FORMAT(a.check_in, '%M')")
      .orderByRaw("DATE_FORMAT(a.check_in, '%Y-%m')");

    const monthMap = {};
    trendRaw.forEach(row => {
      monthMap[row.month_name] = {
        present: Number(row.present || 0),
        absent: Number(row.absent || 0),
        half: Number(row.half || 0),
      };
    });

    const monthsOrder = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];

    const trend = monthsOrder.map(month => ({
      month,
      present: monthMap[month]?.present || 0,
      absent: monthMap[month]?.absent || 0,
      half: monthMap[month]?.half || 0,
    }));

    // ========= Summary (scoped to same filters) =========
    const totalEmployees = await knex('employees')
      .count('* as count')
      .where({ company_id: companyId })
      .first();

    const avgAttendanceRaw = await base
      .clone()
      .whereNotNull('a.check_in')
      .select(
        knex.raw("SUM(CASE WHEN a.status = 'present' THEN 1 WHEN a.status = 'half' THEN 0.5 ELSE 0 END) / COUNT(*) * 100 as avg_att")
      )
      .first();

    const todayStats = await base
      .clone()
      .whereNotNull('a.check_in')
      .whereRaw('DATE(a.check_in) = CURDATE()')
      .select('a.status')
      .count('* as count')
      .groupBy('a.status');

    const presentToday = todayStats.find(s => s.status === 'present')?.count || 0;
    const onLeaveToday = todayStats.find(s => s.status === 'leave')?.count || 0;

    const summary = {
      totalEmployees: totalEmployees?.count || 0,
      avgAttendance: avgAttendanceRaw?.avg_att ? `${Number(avgAttendanceRaw.avg_att).toFixed(1)}%` : '0%',
      presentToday,
      onLeave: onLeaveToday,
    };

    return res.json({
      success: true,
      data: { trend, summary, rows, leaveRows, permissionRows },
    });
  } catch (err) {
    console.error('Attendance report error:', err);
    res.status(500).json({ success: false, message: 'Failed to generate attendance report' });
  }
};
/* =========================
   LEAVE REPORT
========================= */
// Fixed getLeaveReport function (replace in your reports.controller.js)

const getLeaveReport = async (req, res) => {
  const companyId = req.user.company_id;
  const year = getYear(req); // optional: current year or from query

  try {
    // Use correct table: leave_applications (not 'leaves')
    // Assume column is 'leave_type_name' based on your earlier code
    const distribution = await knex('leave_applications')
      .select('leave_type_name as name')
      .count('* as value')
      .where({ company_id: companyId, status: 'approved' })
      .andWhereRaw('YEAR(from_date) = ?', [year]) // filter by year (optional, remove if you want all time)
      .groupBy('leave_type_name');

    // Add colors for PieChart (same as frontend)
    const colors = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#6366f1'];
    const leaveData = distribution.map((row, idx) => ({
      name: row.name || 'Other',
      value: Number(row.value),
      fill: colors[idx % colors.length],
    }));

    // Statistics
    const totalEmployees = await knex('employees')
      .count('* as count')
      .where({ company_id: companyId })
      .first();

    const approved = await knex('leave_applications')
      .count('* as count')
      .where({ company_id: companyId, status: 'approved' })
      .first();

    const pending = await knex('leave_applications')
      .count('* as count')
      .where({ company_id: companyId, status: 'pending' })
      .first();

    // Average days used (assume 'days' column exists in leave_applications)
    const avgDays = await knex('leave_applications')
      .avg('days as avg')
      .where({ company_id: companyId, status: 'approved' })
      .first();

    const stats = {
      totalEmployees: totalEmployees?.count || 0,
      approvedLeaves: approved?.count || 0,
      pendingRequests: pending?.count || 0,
      avgDaysUsed: Number(avgDays?.avg || 0).toFixed(1),
    };

    res.json({
      success: true,
      data: { distribution: leaveData, stats },
    });
  } catch (err) {
    console.error('Leave report error:', err);
    res.status(500).json({ success: false, message: 'Failed to generate leave report' });
  }
};

/* =========================
   PAYROLL REPORT
========================= */
// Updated getPayrollReport (replace in reports.controller.js)
const getPayrollReport = async (req, res) => {
  const companyId = req.user.company_id;
  const year = getYear(req);

  try {
    console.log(`Generating payroll report for company: ${companyId}, year: ${year}`);

    // Get data with a simpler year filter
    const trendRaw = await knex('payroll_processing')
      .select(
        'month', // Select the raw month value
        knex.raw('SUM(gross) as amount')
      )
      .where({ company_id: companyId })
      .andWhere('month', 'like', `${year}-%`)
      .groupBy('month')  // Group by the raw month value
      .orderBy('month');  // Order by the raw month value

    console.log('Trend data with simplified filter:', JSON.stringify(trendRaw, null, 2));

    // Create a map of month number to amount
    const monthMap = {};
    trendRaw.forEach(row => {
      // Extract month number from 'YYYY-MM' format (1-12)
      const monthNum = parseInt(row.month.split('-')[1], 10) - 1; // Convert to 0-11 for JS
      monthMap[monthNum] = Math.round(Number(row.amount) / 1000); // in ₹K
    });

    const monthsOrder = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];

    const trend = monthsOrder.map((month, index) => ({
      month,
      amount: monthMap[index] || 0
    }));

    // Calculate summary data
    const totalEmployees = await knex('employees')
      .count('* as count')
      .where({ company_id: companyId })
      .first();

    const avgSalaryRaw = await knex('payroll_structures')
      .avg('gross as avg')
      .where({ company_id: companyId })
      .first();

    // Calculate YTD total
    const ytdTotal = trendRaw.reduce((sum, row) => sum + Number(row.amount), 0);

    // Get current month data (0-11)
    const currentMonth = new Date().getMonth();
    const currentMonthData = monthMap[currentMonth] || 0;

    const summary = {
      totalEmployees: totalEmployees?.count || 0,
      avgSalary: avgSalaryRaw?.avg ? `₹${Math.round(Number(avgSalaryRaw.avg)).toLocaleString()}` : '₹0',
      totalPayroll: currentMonthData ? `₹${currentMonthData}K` : '₹0K',
      ytdAmount: ytdTotal ? `₹${(ytdTotal / 1000000).toFixed(1)}M` : '₹0M',
    };

    console.log('Final response:', { trend, summary });

    res.json({
      success: true,
      data: { trend, summary },
    });
  } catch (err) {
    console.error('Payroll report error:', err);
    res.status(500).json({ success: false, message: 'Failed to generate payroll report' });
  }
};
/* =========================
   EXPENSE REPORT
========================= */
const getExpenseReport = async (req, res) => {
  try {
    const companyId = await resolveCompanyId(req);
    const year = getYear(req);

    if (!companyId) {
      return res.status(400).json({
        success: false,
        message: 'Company context missing for report generation',
      });
    }

    console.log(`Fetching expense report for company: ${companyId}, year: ${year}`);
    const expensesHasCompanyId = await knex.schema.hasColumn('expenses', 'company_id');

    // First, check if any expenses exist at all
    let allExpensesQuery = knex('expenses as e');
    if (expensesHasCompanyId) {
      allExpensesQuery = allExpensesQuery.where('e.company_id', companyId);
    } else {
      allExpensesQuery = allExpensesQuery
        .join('employees as eemp', 'eemp.id', 'e.employee_id')
        .where('eemp.company_id', companyId);
    }

    const allExpenses = await allExpensesQuery
      .select('category', 'amount', 'status');
    
    console.log('All expenses for company:', JSON.stringify(allExpenses, null, 2));

    // First, get all categories to ensure we don't miss any
    let allCategoriesQuery = knex('expenses as e')
      .distinct('e.category');

    if (expensesHasCompanyId) {
      allCategoriesQuery = allCategoriesQuery.where('e.company_id', companyId);
    } else {
      allCategoriesQuery = allCategoriesQuery
        .join('employees as eemp', 'eemp.id', 'e.employee_id')
        .where('eemp.company_id', companyId);
    }

    const allCategories = await allCategoriesQuery
      .pluck('category');

    console.log('All categories found:', allCategories);

    // Get category data without year filter first to debug
    let allCategoryDataQuery = knex('expenses as e')
      .select('e.category as category')
      .sum('e.amount as amount')
      .andWhereRaw('LOWER(e.status) = ?', ['approved']);

    if (expensesHasCompanyId) {
      allCategoryDataQuery = allCategoryDataQuery.where('e.company_id', companyId);
    } else {
      allCategoryDataQuery = allCategoryDataQuery
        .join('employees as eemp', 'eemp.id', 'e.employee_id')
        .where('eemp.company_id', companyId);
    }

    const allCategoryData = await allCategoryDataQuery
      .groupBy('e.category');

    console.log('All category data (no year filter):', JSON.stringify(allCategoryData, null, 2));

    // Then get data with year filter
    let categoryDataQuery = knex('expenses as e')
      .select('e.category as category')
      .sum('e.amount as amount')
      .andWhereRaw('LOWER(e.status) = ?', ['approved'])
      .andWhereRaw('YEAR(e.expense_date) = ?', [year]);

    if (expensesHasCompanyId) {
      categoryDataQuery = categoryDataQuery.where('e.company_id', companyId);
    } else {
      categoryDataQuery = categoryDataQuery
        .join('employees as eemp', 'eemp.id', 'e.employee_id')
        .where('eemp.company_id', companyId);
    }

    const categoryData = await categoryDataQuery
      .groupBy('e.category');

    console.log('Filtered category data (with year filter):', JSON.stringify(categoryData, null, 2));

    // Process summary data using filtered data
    let summaryData = categoryData
      .filter(row => row.category) // Filter out null/undefined categories
      .map(row => ({
        category: row.category,
        amount: Math.round(Number(row.amount) || 0),
      }));

    // If still empty, try without any status filter
    if (summaryData.length === 0) {
      console.log('Summary is empty, trying without status filter...');
      const fallbackData = await knex('expenses')
        .select('category')
        .sum('amount as amount')
        .modify((queryBuilder) => {
          if (expensesHasCompanyId) {
            queryBuilder.where('expenses.company_id', companyId);
          } else {
            queryBuilder
              .join('employees as eemp', 'eemp.id', 'expenses.employee_id')
              .where('eemp.company_id', companyId);
          }
        })
        .groupBy('category');
      
      summaryData = fallbackData
        .filter(row => row.category)
        .map(row => ({
          category: row.category,
          amount: Math.round(Number(row.amount) || 0),
        }));
      
      console.log('Fallback summary data:', JSON.stringify(summaryData, null, 2));
    }

    console.log('Final summary data:', JSON.stringify(summaryData, null, 2));

    // Get stats with proper null handling
    const [totalClaims, totalAmount, pendingAmount] = await Promise.all([
      knex('expenses as e')
        .count('* as count')
        .modify((queryBuilder) => {
          if (expensesHasCompanyId) {
            queryBuilder.where('e.company_id', companyId);
          } else {
            queryBuilder
              .join('employees as eemp', 'eemp.id', 'e.employee_id')
              .where('eemp.company_id', companyId);
          }
        })
        .first(),
      knex('expenses as e')
        .sum('e.amount as total')
        .modify((queryBuilder) => {
          if (expensesHasCompanyId) {
            queryBuilder.where('e.company_id', companyId);
          } else {
            queryBuilder
              .join('employees as eemp', 'eemp.id', 'e.employee_id')
              .where('eemp.company_id', companyId);
          }
        })
        .andWhereRaw('LOWER(e.status) = ?', ['approved'])
        .first(),
      knex('expenses as e')
        .sum('e.amount as total')
        .modify((queryBuilder) => {
          if (expensesHasCompanyId) {
            queryBuilder.where('e.company_id', companyId);
          } else {
            queryBuilder
              .join('employees as eemp', 'eemp.id', 'e.employee_id')
              .where('eemp.company_id', companyId);
          }
        })
        .andWhereRaw('LOWER(e.status) = ?', ['pending'])
        .first()
    ]);

    console.log('Stats raw data:', {
      totalClaims,
      totalAmount,
      pendingAmount
    });

    const response = {
      success: true,
      data: {
        summary: summaryData,
        stats: {
          totalClaims: Number(totalClaims?.count) || 0,
          totalAmount: totalAmount?.total ? `₹${Math.round(Number(totalAmount.total)).toLocaleString()}` : '₹0',
          pendingApproval: pendingAmount?.total ? `₹${Math.round(Number(pendingAmount.total)).toLocaleString()}` : '₹0',
        }
      }
    };

    console.log('Final response:', JSON.stringify(response, null, 2));
    res.json(response);

  } catch (err) {
    console.error('Expense report error:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to generate expense report',
      error: err.message 
    });
  }
};

// Export all functions (CommonJS)
module.exports = {
  getAttendanceReport,
  getLeaveReport,
  getPayrollReport,
  getExpenseReport,
};
