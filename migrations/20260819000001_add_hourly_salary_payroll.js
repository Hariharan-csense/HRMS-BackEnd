// Adds an opt-in hourly payroll mode without changing legacy monthly rows.
exports.up = async function (knex) {
  const employeeColumns = await knex("employees").columnInfo();
  await knex.schema.alterTable("employees", (table) => {
    if (!employeeColumns.salary_type)
      table
        .enum("salary_type", ["MONTHLY", "HOURLY"])
        .notNullable()
        .defaultTo("MONTHLY");
    if (!employeeColumns.monthly_salary)
      table.decimal("monthly_salary", 12, 2).nullable();
    if (!employeeColumns.hourly_rate)
      table.decimal("hourly_rate", 12, 2).nullable();
    if (!employeeColumns.overtime_hourly_rate)
      table.decimal("overtime_hourly_rate", 12, 2).nullable();
  });
  await knex("employees")
    .whereNull("monthly_salary")
    .update({ monthly_salary: knex.ref("salary") });
  const payrollColumns = await knex("payroll_processing").columnInfo();
  await knex.schema.alterTable("payroll_processing", (table) => {
    if (!payrollColumns.salary_type)
      table
        .enum("salary_type", ["MONTHLY", "HOURLY"])
        .notNullable()
        .defaultTo("MONTHLY");
    if (!payrollColumns.hourly_rate)
      table.decimal("hourly_rate", 12, 2).nullable();
    if (!payrollColumns.overtime_hourly_rate)
      table.decimal("overtime_hourly_rate", 12, 2).nullable();
    if (!payrollColumns.total_worked_hours)
      table.decimal("total_worked_hours", 10, 2).notNullable().defaultTo(0);
    if (!payrollColumns.normal_hours)
      table.decimal("normal_hours", 10, 2).notNullable().defaultTo(0);
    if (!payrollColumns.overtime_hours)
      table.decimal("overtime_hours", 10, 2).notNullable().defaultTo(0);
    if (!payrollColumns.normal_pay)
      table.decimal("normal_pay", 12, 2).notNullable().defaultTo(0);
    if (!payrollColumns.overtime_pay)
      table.decimal("overtime_pay", 12, 2).notNullable().defaultTo(0);
  });
};

exports.down = async function (knex) {
  const payrollColumns = await knex("payroll_processing").columnInfo();
  await knex.schema.alterTable("payroll_processing", (table) => {
    [
      "overtime_pay",
      "normal_pay",
      "overtime_hours",
      "normal_hours",
      "total_worked_hours",
      "overtime_hourly_rate",
      "hourly_rate",
      "salary_type",
    ].forEach((column) => {
      if (payrollColumns[column]) table.dropColumn(column);
    });
  });
  const employeeColumns = await knex("employees").columnInfo();
  await knex.schema.alterTable("employees", (table) => {
    [
      "overtime_hourly_rate",
      "hourly_rate",
      "monthly_salary",
      "salary_type",
    ].forEach((column) => {
      if (employeeColumns[column]) table.dropColumn(column);
    });
  });
};
