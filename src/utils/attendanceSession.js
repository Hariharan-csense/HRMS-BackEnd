// The latest punch determines the current session. Older incomplete historical
// records must not reopen a session after a later punch has been checked out.
// An open latest punch remains active until an explicit checkout, without expiry.
async function findActiveAttendance(db, { companyId, employeeId, at = new Date() }) {
  const latest = await db('attendance')
    .where({ company_id: companyId, employee_id: employeeId })
    .where('check_in', '<=', at)
    .orderBy('check_in', 'desc')
    .orderBy('id', 'desc')
    .first();
  return latest && latest.check_out == null ? latest : null;
}

module.exports = { findActiveAttendance };
