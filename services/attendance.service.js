const knex = require('../db/db');
const { calculateStandardHours, determineShiftType } = require('../utils/shift.util');
const { verifyFace, saveImage } = require('../utils/face.util');
const { getEmployeeShift } = require('../utils/shift.util');
const path = require('path');

async function doCheckIn({
  employeeId,
  companyId,
  imageData = null,
  location = null,
  deviceInfo = 'Web',
  shiftId = null,
  shiftType = 'regular'
}) {
  const employee = await knex('employees')
    .where({ id: employeeId, company_id: companyId })
    .first();

  if (!employee) throw new Error('Employee not found');

  // Face verify ONLY for Web
  if (imageData && deviceInfo === 'Web') {
    const faceMatch = await verifyFace(employeeId, imageData);
    if (!faceMatch) throw new Error('Face verification failed');
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const existing = await knex('attendance')
    .where('employee_id', employeeId)
    .where('company_id', companyId)
    .where('check_in', '>=', today)
    .whereNull('check_out')
    .first();

  if (existing) throw new Error('Already checked in');

  // Use provided shift parameters or fetch as fallback
  let finalShiftId = shiftId;
  let finalShiftType = shiftType;
  let employeeShift = null;
  
  if (!finalShiftId) {
    employeeShift = await getEmployeeShift(employeeId, companyId);
    finalShiftId = employeeShift?.shift_id || null;
    finalShiftType = determineShiftType(new Date(), employeeShift);
  }
  
  if (!employeeShift) {
    employeeShift = await getEmployeeShift(employeeId, companyId);
  }
  
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

  const checkInTime = new Date();
  let attendanceStatus = 'present';
  if (employeeShift?.start_time) {
    const [startHour, startMin] = employeeShift.start_time
      .split(':')
      .slice(0, 2)
      .map(Number);

    const shiftStart = new Date(checkInTime);
    shiftStart.setHours(startHour, startMin, 0, 0);

    if (employeeShift?.end_time) {
      const [endHour, endMin] = employeeShift.end_time
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

    if (checkInTime > shiftStart) {
      attendanceStatus = 'late';
    }
  }

  const [insertId] = await knex('attendance')
    .insert({
      company_id: companyId,
      employee_id: employeeId,
      check_in: checkInTime,
      check_in_location: location ? JSON.stringify(location) : null,
      check_in_image_url: imageData ? `/uploads/attendance/company_${companyId}/${path.basename(imageData)}` : null,
      device_info: deviceInfo,
      status: attendanceStatus,
      shift_type: finalShiftType,
      shift_id: finalShiftId
    });

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
  deviceInfo = 'Web'
}) {
  const record = await knex('attendance')
    .where({
      employee_id: employeeId,
      company_id: companyId
    })
    .whereNull('check_out')
    .whereRaw('DATE(check_in) = CURDATE()')
    .first();

  if (!record) throw new Error('No active check-in');

  if (imageData && deviceInfo === 'Web') {
    const faceMatch = await verifyFace(employeeId, imageData);
    if (!faceMatch) throw new Error('Face verification failed');
  }

  const checkOutTime = new Date();
  let hoursWorked =
    (checkOutTime - new Date(record.check_in)) / (1000 * 60 * 60);

  if (hoursWorked < 0.0167) hoursWorked = 0.0167;

  const employeeShift = await getEmployeeShift(employeeId, companyId);
  const standardHours = calculateStandardHours(employeeShift);
  const overtimeHours = Math.max(0, hoursWorked - standardHours);

  await knex('attendance')
    .where('id', record.id)
    .update({
      check_out: checkOutTime,
      hours_worked: hoursWorked,
      overtime_hours: overtimeHours,
      check_out_location: location ? JSON.stringify(location) : null,
      check_out_image_url: imageData ? `/uploads/attendance/company_${companyId}/${path.basename(imageData)}` : null,
      device_info: deviceInfo
    });

  return true;
}

module.exports = {
  doCheckIn,
  doCheckOut
};
