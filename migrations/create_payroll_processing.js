exports.up = function(knex) {
  return knex.schema.createTable('payroll_processing', table => {
    table.increments('id').primary();
    table.integer('employee_id').unsigned().notNullable();
    table.string('month').notNullable(); // e.g., 2024-04
    table.integer('payable_days').notNullable();
    table.decimal('gross', 12, 2).notNullable();
    table.decimal('deductions', 12, 2).notNullable();
    table.decimal('net', 12, 2).notNullable();
    table.enum('status', ['draft', 'processed', 'paid']).defaultTo('draft');
    table.timestamps(true, true);

    table.foreign('employee_id').references('id').inTable('employees').onDelete('CASCADE');
  });
};

exports.down = function(knex) {
  return knex.schema.dropTable('payroll_processing');
};