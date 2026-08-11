const knex = require('../db/db');
const { determineShiftType } = require('../utils/shift.util');
const { verifyFace, saveImage } = require('../utils/face.util');
const { getEmployeeShift } = require('../utils/shift.util');
const { getCompanyPolicy } = require('./companyPolicyService');
const path = require('path');

const resolveStoredImageUrl = (imageData, companyId) => {
  if (!imageData) return null;
  if (typeof imageData !== 'string') return null;
  if (imageData.startsWith('/uploads/')) return imageData;
  return `/uploads/attendance/company_${companyId}/${path.basename(imageData)}`;
};

const getDayWindow = (date) => {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  return { start, end };
};

const getMonthWindow = (date) => {
  const start = new Date(date);
  start.setDate(1);
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setMonth(end.getMonth() + 1);

  return { start, end };
};

const formatDateOnly = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const formatTimeOnly = (date) => {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
};

const timeToMinutes = (value) => {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
};

const calculateStandardHours = (startTime, endTime, fallback = 8) => {
  const startMinutes = timeToMinutes(startTime);
  const endMinutes = timeToMinutes(endTime);
  if (startMinutes === null || endMinutes === null) return fallback;

  let durationMinutes = endMinutes - startMinutes;
  if (durationMinutes <= 0) durationMinutes += 24 * 60;
  return durationMinutes / 60;
};

const getShiftEndForPunch = (attendanceShift, referenceTime) => {
  if (!attendanceShift?.end_time) return null;

  const [endHour, endMin] = String(attendanceShift.end_time)
    .split(':')
    .slice(0, 2)
    .map(Number);
  if ([endHour, endMin].some(Number.isNaN)) return null;

  const shiftEnd = new Date(referenceTime);
  shiftEnd.setHours(endHour, endMin, 0, 0);

  if (attendanceShift?.start_time) {
    const [startHour, startMin] = String(attendanceShift.start_time)
      .split(':')
      .slice(0, 2)
      .map(Number);
    if (![startHour, startMin].some(Number.isNaN)) {
      const shiftStart = new Date(referenceTime);
      shiftStart.setHours(startHour, startMin, 0, 0);
      if (shiftEnd <= shiftStart) {
        shiftEnd.setDate(shiftEnd.getDate() + 1);
      }
    }
  }

  return shiftEnd;
};

const getAttendancePolicyShift = async (companyId) => {
  const policy = await getCompanyPolicy(companyId);
  const attendancePolicy = policy?.attendance;
  if (!attendancePolicy?.gracePolicyEnabled) return null;

  return {
    start_time: attendancePolicy.workStartTime,
    end_time: attendancePolicy.workEndTime,
    grace_period: attendancePolicy.gracePeriodMinutes,
    grace_days_per_month: attendancePolicy.graceDaysPerMonth,
    half_day_threshold: attendancePolicy.halfDayThresholdHours,
    standard_hours: calculateStandardHours(
      attendancePolicy.workStartTime,
      attendancePolicy.workEndTime,
    ),
  };
};

const getActivePermissionForPunch = async ({ companyId, employeeId, punchTime }) => {
  const punchDate = formatDateOnly(punchTime);
  const punchTimeOnly = formatTimeOnly(punchTime);

  return knex('leave_permissions')
    .where({
      company_id: companyId,
      employee_id: employeeId
    })
    .whereIn('status', ['pending', 'approved'])
    .whereRaw('DATE(permission_date) = ?', [punchDate])
    .where('permission_time_from', '<=', punchTimeOnly)
    .where('permission_time_to', '>=', punchTimeOnly)
    .orderByRaw("CASE WHEN status = 'approved' THEN 0 ELSE 1 END")
    .orderBy('created_at', 'desc')
    .first();
};

const hasGraceDayAvailable = async ({
  companyId,
  employeeId,
  punchTime,
  graceDaysPerMonth,
}) => {
  const monthlyLimit = Number(graceDaysPerMonth || 0);
  if (monthlyLimit <= 0) return true;

  const { start, end } = getMonthWindow(punchTime);
  const row = await knex('attendance')
    .where({
      company_id: companyId,
      employee_id: employeeId,
      status: 'grace'
    })
    .where('check_in', '>=', start)
    .where('check_in', '<', end)
    .count({ count: '*' })
    .first();

  return Number(row?.count || 0) < monthlyLimit;
};

async function doCheckIn({
  employeeId,
  companyId,
  clientId = null,
  imageData = null,
  location = null,
  deviceInfo = 'Web',
  shiftId = null,
  shiftType = 'regular',
  punchTime = null
}) {
  const employee = await knex('employees')
    .where({ id: employeeId, company_id: companyId })
    .first();

  if (!employee) throw new Error('Employee not found');

  const effectivePunchTime = punchTime ? new Date(punchTime) : new Date();
  if (Number.isNaN(effectivePunchTime.getTime())) {
    throw new Error('Invalid punch time');
  }

  const { start: attendanceDayStart, end: attendanceDayEnd } = getDayWindow(effectivePunchTime);

  const existing = await knex('attendance')
    .where('employee_id', employeeId)
    .where('company_id', companyId)
    .where('check_in', '>=', attendanceDayStart)
    .where('check_in', '<', attendanceDayEnd)
    .whereNull('check_out')
    .first();

  if (existing) throw new Error('Already checked in');

  // Face verify ONLY for Web
  if (imageData && deviceInfo === 'Web') {
    const faceMatch = await verifyFace(employeeId, imageData);
    if (!faceMatch) throw new Error('Face verification failed');
  }

  // Use provided shift parameters or fetch as fallback
  let finalShiftId = shiftId;
  let finalShiftType = shiftType;
  let employeeShift = null;
  
  if (!finalShiftId) {
    employeeShift = await getEmployeeShift(employeeId, companyId);
    finalShiftId = employeeShift?.shift_id || null;
    finalShiftType = determineShiftType(effectivePunchTime, employeeShift);
  }
  
  if (!employeeShift) {
    employeeShift = await getEmployeeShift(employeeId, companyId);
  }

  const policyShift = await getAttendancePolicyShift(companyId);
  const attendanceShift = policyShift || employeeShift;
  
  // Convert shift type to numeric value if it's a string
  if (typeof finalShiftType === 'string') {
    const shiftTypeMap = {
      'regular': 1,
      'overtime': 2,
      'night': 3,
      'weekend': 4,
      'holiday': 5
    };
    finalShiftType = shiftTypeMap[finalShiftType.toLowerCase()] || 1;
  }

  const checkInTime = effectivePunchTime;
  let attendanceStatus = 'present';
  const activePermission = await getActivePermissionForPunch({
    companyId,
    employeeId,
    punchTime: checkInTime
  });

  if (!activePermission && attendanceShift?.start_time) {
    const [startHour, startMin] = attendanceShift.start_time
      .split(':')
      .slice(0, 2)
      .map(Number);

    const shiftStart = new Date(checkInTime);
    shiftStart.setHours(startHour, startMin, 0, 0);

    if (attendanceShift?.end_time) {
      const [endHour, endMin] = attendanceShift.end_time
        .split(':')
        .slice(0, 2)
        .map(Number);

      const shiftEnd = new Date(checkInTime);
      shiftEnd.setHours(endHour, endMin, 0, 0);

      const isOvernightShift = shiftEnd < shiftStart;
      if (isOvernightShift && checkInTime < shiftStart) {
        shiftStart.setDate(shiftStart.getDate() - 1);
      }
    }

    const gracePeriodMinutes = Number(attendanceShift?.grace_period) > 0
      ? Number(attendanceShift.grace_period)
      : 0;
    const graceDaysPerMonth = Number(attendanceShift?.grace_days_per_month) > 0
      ? Number(attendanceShift.grace_days_per_month)
      : 0;
    const halfDayThresholdHours = Number(attendanceShift?.half_day_threshold) > 0
      ? Number(attendanceShift.half_day_threshold)
      : 4;

    const checkInMinute = new Date(checkInTime);
    checkInMinute.setSeconds(0, 0);

    const lateCutoff = new Date(shiftStart.getTime() + gracePeriodMinutes * 60 * 1000);
    const halfDayCutoff = new Date(shiftStart.getTime() + halfDayThresholdHours * 60 * 60 * 1000);

    if (checkInMinute > halfDayCutoff) {
      attendanceStatus = 'half_day';
    } else if (checkInMinute > lateCutoff) {
      attendanceStatus = 'late';
    } else if (checkInMinute > shiftStart && gracePeriodMinutes > 0) {
      attendanceStatus = await hasGraceDayAvailable({
        companyId,
        employeeId,
        punchTime: checkInTime,
        graceDaysPerMonth
      })
        ? 'grace'
        : 'late';
    }
  }

  const insertPayload = {
    company_id: companyId,
    employee_id: employeeId,
    check_in: checkInTime,
    check_in_location: location ? JSON.stringify(location) : null,
    check_in_image_url: resolveStoredImageUrl(imageData, companyId),
    device_info: deviceInfo,
    status: attendanceStatus,
    shift_type: finalShiftType,
    shift_id: finalShiftId
  };

  if (clientId && await knex.schema.hasColumn('attendance', 'client_id')) {
    insertPayload.client_id = clientId;
  }

  const [insertId] = await knex('attendance').insert(insertPayload);

  const attendance = await knex('attendance')
    .where('id', insertId)
    .first();

  return attendance;
}

async function doCheckOut({
  employeeId,
  companyId,
  imageData = null,
  location = null,
  deviceInfo = 'Web',
  punchTime = null
}) {
  const effectivePunchTime = punchTime ? new Date(punchTime) : new Date();
  if (Number.isNaN(effectivePunchTime.getTime())) {
    throw new Error('Invalid punch time');
  }

  const attendanceDay = effectivePunchTime.toISOString().slice(0, 10);

  const record = await knex('attendance')
    .where({
      employee_id: employeeId,
      company_id: companyId
    })
    .whereNull('check_out')
    .whereRaw('DATE(check_in) = ?', [attendanceDay])
    .first();

  if (!record) throw new Error('No active check-in');

  if (imageData && deviceInfo === 'Web') {
    const faceMatch = await verifyFace(employeeId, imageData);
    if (!faceMatch) throw new Error('Face verification failed');
  }

  const checkOutTime = effectivePunchTime;
  let hoursWorked =
    (checkOutTime - new Date(record.check_in)) / (1000 * 60 * 60);

  if (hoursWorked < 0.0167) hoursWorked = 0.0167;

  const employeeShift = await getEmployeeShift(employeeId, companyId);
  const policyShift = await getAttendancePolicyShift(companyId);
  const attendanceShift = policyShift || employeeShift;
  const pulsePromptShift = employeeShift?.end_time ? employeeShift : policyShift;
  const standardHours =
    Number(attendanceShift?.standard_hours) > 0
      ? Number(attendanceShift.standard_hours)
      : 8;
  // Keep day status determined at check-in by shift start + grace + half-day cutoff.
  // Checkout should only finalize hours/overtime, not downgrade/upgrade attendance status.
  const overtimeHours = Math.max(0, hoursWorked - standardHours);
  const finalStatus = record.status || 'present';
  const shiftEnd = getShiftEndForPunch(pulsePromptShift, new Date(record.check_in));
  const shouldPromptDailyPulse = shiftEnd
    ? checkOutTime >= shiftEnd
    : false;

  await knex('attendance')
    .where('id', record.id)
    .update({
      check_out: checkOutTime,
      hours_worked: hoursWorked,
      overtime_hours: overtimeHours,
      check_out_location: location ? JSON.stringify(location) : null,
      check_out_image_url: resolveStoredImageUrl(imageData, companyId),
      device_info: deviceInfo,
      status: finalStatus
    });

  const attendance = await knex('attendance')
    .where('id', record.id)
    .first();

  return {
    attendance,
    shouldPromptDailyPulse,
    shiftEndTime: shiftEnd ? shiftEnd.toISOString() : null,
    shiftEndSource: employeeShift?.end_time ? 'employee_shift' : 'company_policy'
  };
}

module.exports = {
  doCheckIn,
  doCheckOut
};
