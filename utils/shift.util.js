const knex = require('../db/db');

/**
 * Fetch the active shift for an employee
 * @param {number} employeeId
 * @param {number} companyId
 * @returns {object|null} shift info or null
 */
async function getEmployeeShift(employeeId, companyId) {
  const empId = Number(employeeId);
  const compId = Number(companyId);

  if (!empId || !compId) {
    console.log("Invalid employeeId or companyId:", employeeId, companyId);
    return null;
  }

  try {
    const employee = await knex('employees')
      .where({ id: empId, company_id: compId })
      .first();

    if (!employee) {
      console.log(`Employee ${empId} not found for company ${compId}`);
      return null;
    }

    if (!employee.shift_id) {
      console.log(`Employee ${empId} has no shift_id assigned`);
      return null;
    }

    const shift = await knex('shifts')
      .where({ id: employee.shift_id })
      .first();

    if (!shift) {
      console.log(`Shift not found for shift_id ${employee.shift_id}`);
      return null;
    }

    return shift;

  } catch (err) {
    console.error('getEmployeeShift error:', err);
    return null;
  }
}




/**
 * Calculate standard hours from a shift object
 * @param {object} shift
 * @returns {number} hours
 */
function calculateStandardHours(shift) {
  if (!shift?.start_time || !shift?.end_time) return 8;

  const [sh, sm] = shift.start_time.split(':').map(Number);
  const [eh, em] = shift.end_time.split(':').map(Number);

  const start = new Date();
  start.setHours(sh, sm, 0, 0);

  const end = new Date();
  end.setHours(eh, em, 0, 0);

  if (end < start) end.setDate(end.getDate() + 1);

  return (end - start) / (1000 * 60 * 60);
}

/**
 * Determine shift type (placeholder logic)
 * @param {Date} date
 * @param {object} shift
 * @returns {string}
 */
function determineShiftType(date, shift) {
  // Placeholder: always return 'regular'
  return 'regular';
}

module.exports = {
  getEmployeeShift,
  calculateStandardHours,
  determineShiftType
};
