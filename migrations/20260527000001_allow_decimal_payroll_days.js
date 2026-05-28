exports.up = async function(knex) {
  const dayColumns = [
    'total_days',
    'present_days',
    'approved_leave_days',
    'payable_days',
    'lop_days',
  ];
  const existingColumns = [];

  for (const columnName of dayColumns) {
    if (await knex.schema.hasColumn('payroll_processing', columnName)) {
      existingColumns.push(columnName);
    }
  }

  if (!existingColumns.length) return;

  await knex.schema.alterTable('payroll_processing', table => {
    for (const columnName of existingColumns) {
      table.decimal(columnName, 6, 2).notNullable().defaultTo(0).alter();
    }
  });
};

exports.down = async function(knex) {
  const dayColumns = [
    'total_days',
    'present_days',
    'approved_leave_days',
    'payable_days',
    'lop_days',
  ];
  const existingColumns = [];

  for (const columnName of dayColumns) {
    if (await knex.schema.hasColumn('payroll_processing', columnName)) {
      existingColumns.push(columnName);
    }
  }

  if (!existingColumns.length) return;

  await knex.schema.alterTable('payroll_processing', table => {
    for (const columnName of existingColumns) {
      table.integer(columnName).notNullable().defaultTo(0).alter();
    }
  });
};
