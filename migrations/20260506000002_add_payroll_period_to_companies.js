exports.up = async function(knex) {
  const hasPayrollStartDay = await knex.schema.hasColumn('companies', 'payroll_start_day');
  if (!hasPayrollStartDay) {
    await knex.schema.alterTable('companies', table => {
      table.integer('payroll_start_day').notNullable().defaultTo(1).after('payroll_cycle');
    });
  }

  const hasPayrollEndDay = await knex.schema.hasColumn('companies', 'payroll_end_day');
  if (!hasPayrollEndDay) {
    await knex.schema.alterTable('companies', table => {
      table.integer('payroll_end_day').notNullable().defaultTo(31).after('payroll_start_day');
    });
  }
};

exports.down = async function(knex) {
  const hasPayrollEndDay = await knex.schema.hasColumn('companies', 'payroll_end_day');
  if (hasPayrollEndDay) {
    await knex.schema.alterTable('companies', table => {
      table.dropColumn('payroll_end_day');
    });
  }

  const hasPayrollStartDay = await knex.schema.hasColumn('companies', 'payroll_start_day');
  if (hasPayrollStartDay) {
    await knex.schema.alterTable('companies', table => {
      table.dropColumn('payroll_start_day');
    });
  }
};
