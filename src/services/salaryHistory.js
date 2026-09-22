const parseSnapshot = (value) => typeof value === "string" ? JSON.parse(value) : value;
const validMonth = (value) => /^\d{4}-(0[1-9]|1[0-2])$/.test(value || "");

async function salaryForMonth(db, companyId, employeeId, month, snapshot) {
  if (snapshot) return parseSnapshot(snapshot);
  const version = await db("payroll_structure_history")
    .where({ company_id: companyId, employee_id: employeeId })
    .where("effective_month", "<=", month)
    .orderBy("effective_month", "desc").first();
  return version ? parseSnapshot(version.structure_data) : null;
}

async function reviseSalary(db, companyId, employeeId, payload, month) {
  if (!validMonth(month)) {
    const error = new Error("A valid effective payroll month (YYYY-MM) is required");
    error.status = 400;
    throw error;
  }
  return db.transaction(async (trx) => {
    // Serialize both update entry points for this employee.
    await trx("employees").where({ id: employeeId, company_id: companyId }).forUpdate().first();
    const current = await trx("payroll_structures")
      .where({ company_id: companyId, employee_id: employeeId }).first();
    const data = { ...current, ...payload };
    delete data.id;
    delete data.created_at;
    delete data.updated_at;
    // Freeze existing payslips before a same-month correction changes history.
    const legacyPayrolls = await trx("payroll_processing")
      .where({ company_id: companyId, employee_id: employeeId })
      .whereNull("salary_structure_snapshot");
    for (const payroll of legacyPayrolls) {
      const historical = await salaryForMonth(trx, companyId, employeeId, payroll.month);
      if (historical) {
        await trx("payroll_processing").where({ id: payroll.id, company_id: companyId })
          .whereNull("salary_structure_snapshot")
          .update({ salary_structure_snapshot: JSON.stringify(historical) });
      }
    }
    await trx("payroll_structure_history").insert({
      company_id: companyId, employee_id: employeeId,
      effective_month: month, structure_data: JSON.stringify(data),
    }).onConflict(["company_id", "employee_id", "effective_month"])
      .merge(["structure_data"]);
    const latest = await salaryForMonth(trx, companyId, employeeId, "9999-12");
    delete latest.id;
    delete latest.created_at;
    delete latest.updated_at;
    if (current) {
      await trx("payroll_structures").where({ id: current.id, company_id: companyId })
        .update({ ...latest, updated_at: trx.fn.now() });
    } else {
      await trx("payroll_structures").insert({ ...latest, company_id: companyId, employee_id: employeeId });
    }
  });
}

module.exports = { salaryForMonth, reviseSalary, parseSnapshot, validMonth };
