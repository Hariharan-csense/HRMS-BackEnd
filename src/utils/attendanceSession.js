// The latest recent punch determines the current session. An unclosed row from
// an abandoned day must not be reused for a later attendance session.
async function findActiveAttendance(
  db,
  { companyId, employeeId, at = new Date() },
) {
  const maxOpenHours = Math.max(
    1,
    Number(process.env.ATTENDANCE_MAX_OPEN_HOURS) || 24,
  );
  const earliestOpenTime = new Date(
    new Date(at).getTime() - maxOpenHours * 60 * 60 * 1000,
  );

  const latest = await db("attendance")
    .where({ company_id: companyId, employee_id: employeeId })
    .where("check_in", "<=", at)
    .where("check_in", ">=", earliestOpenTime)
    .orderBy("check_in", "desc")
    .orderBy("id", "desc")
    .first();
  return latest && latest.check_out == null ? latest : null;
}

module.exports = { findActiveAttendance };
