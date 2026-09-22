const test = require("node:test");
const assert = require("node:assert/strict");
const { salaryForMonth, reviseSalary, validMonth } = require("./salaryHistory");

test("effective month requires a valid year and month", async () => {
  for (const value of [undefined, "", "2026-00", "2026-13", "2026-9", "2026-09-01"]) {
    assert.equal(validMonth(value), false);
    await assert.rejects(reviseSalary(null, 1, 1, {}, value), { status: 400 });
  }
  assert.equal(validMonth("2026-09"), true);
});

test("processed payroll snapshot takes precedence over any later salary changes", async () => {
  const db = () => { throw new Error("Must not query current salary"); };
  const snapshot = { basic: 24000, hra: 16000, gross: 40000, pf: 1200 };
  assert.deepEqual(await salaryForMonth(db, 1, 2, "2026-08", JSON.stringify(snapshot)), snapshot);
  assert.deepEqual(await salaryForMonth(db, 1, 2, "2026-08", snapshot), snapshot);
});

// Explicitly enabled because this exercises the configured MySQL database.
// All fixture changes are inside an outer transaction that is always rolled back.
test("MySQL: August retains 40k after September increases to 44k", {
  skip: process.env.RUN_SALARY_DB_TEST !== "1",
}, async () => {
  const db = require("../db/db");
  const rollback = new Error("ROLLBACK_TEST_FIXTURES");
  try {
    await assert.rejects(db.transaction(async (trx) => {
      const current = await trx("payroll_structures").first();
      assert.ok(current, "An existing salary structure is needed for the rollback fixture");
      const companyId = current.company_id;
      const employeeId = current.employee_id;
      await trx("employees").where({ id: employeeId, company_id: companyId }).forUpdate().first();
      await trx("payroll_structure_history").where({ company_id: companyId, employee_id: employeeId }).del();
      const original = { ...current, basic: 24000, hra: 16000, gross: 40000 };
      await trx("payroll_structure_history").insert({
        company_id: companyId, employee_id: employeeId,
        effective_month: "2026-01", structure_data: JSON.stringify(original),
      });
      await reviseSalary(trx, companyId, employeeId, { basic: 26400, hra: 17600, gross: 44000 }, "2026-09");
      assert.equal(Number((await salaryForMonth(trx, companyId, employeeId, "2026-08")).gross), 40000);
      assert.equal(Number((await salaryForMonth(trx, companyId, employeeId, "2026-09")).gross), 44000);
      assert.equal(Number((await salaryForMonth(trx, companyId, employeeId, "2027-01")).gross), 44000);
      assert.equal(await salaryForMonth(trx, companyId, employeeId, "2025-12"), null);
      assert.equal(await salaryForMonth(trx, 0, employeeId, "2026-09"), null);
      const frozen = JSON.stringify(await salaryForMonth(trx, companyId, employeeId, "2026-09"));
      await reviseSalary(trx, companyId, employeeId, { gross: 45000 }, "2026-09");
      assert.equal(Number((await salaryForMonth(trx, companyId, employeeId, "2026-09", frozen)).gross), 44000);
      assert.equal(Number((await salaryForMonth(trx, companyId, employeeId, "2026-09")).gross), 45000);
      // Adding an older version must not replace the latest structure.
      await reviseSalary(trx, companyId, employeeId, { gross: 42000 }, "2026-07");
      assert.equal(Number((await salaryForMonth(trx, companyId, employeeId, "2026-08")).gross), 42000);
      const latest = await trx("payroll_structures").where({ id: current.id }).first();
      assert.equal(Number(latest.gross), 45000);
      throw rollback;
    }), (error) => error === rollback);
  } finally {
    await db.destroy();
  }
});
