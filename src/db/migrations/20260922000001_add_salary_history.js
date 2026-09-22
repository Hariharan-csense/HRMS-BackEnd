exports.up = async function (knex) {
  await knex.schema.createTable("payroll_structure_history", (table) => {
    table.increments("id").primary();
    table.integer("company_id").unsigned().notNullable();
    table.integer("employee_id").unsigned().notNullable();
    table.string("effective_month", 7).notNullable();
    table.json("structure_data").notNullable();
    table.timestamps(true, true);
    table.unique(
      ["company_id", "employee_id", "effective_month"],
      "salary_history_employee_month_unique",
    );
  });
  await knex.schema.alterTable("payroll_processing", (table) => {
    table.json("salary_structure_snapshot").nullable();
  });
  // Legacy data has no effective date. Preserve the only known structure as
  // a baseline; never invent earlier salary amounts or backfill payslip snapshots.
  const structures = await knex("payroll_structures").select("*");
  for (const structure of structures) {
    await knex("payroll_structure_history").insert({
      company_id: structure.company_id,
      employee_id: structure.employee_id,
      effective_month: "0001-01",
      structure_data: JSON.stringify(structure),
    });
  }
};

exports.down = async function (knex) {
  await knex.schema.alterTable("payroll_processing", (table) =>
    table.dropColumn("salary_structure_snapshot"),
  );
  await knex.schema.dropTable("payroll_structure_history");
};
