exports.up = function(knex) {
  return knex.schema.createTable('payroll_structures', table => {
    table.increments('id').primary();
    table.integer('employee_id').unsigned().notNullable();
    table.decimal('basic', 12, 2).notNullable();
    table.decimal('hra', 12, 2).defaultTo(0);
    table.decimal('allowances', 12, 2).defaultTo(0);
    table.decimal('incentives', 12, 2).defaultTo(0);
    table.decimal('gross', 12, 2).notNullable();
    table.decimal('pf', 12, 2).defaultTo(0);
    table.decimal('esi', 12, 2).defaultTo(0);
    table.decimal('pt', 12, 2).defaultTo(0);
    table.decimal('tds', 12, 2).defaultTo(0);
    table.decimal('other_deductions', 12, 2).defaultTo(0);
    table.timestamps(true, true);

    table.foreign('employee_id').references('id').inTable('employees').onDelete('CASCADE');
    table.unique('employee_id');
  });
};

exports.down = function(knex) {
  return knex.schema.dropTable('payroll_structures');
};