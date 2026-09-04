exports.up = function(knex) {
  return knex.schema.createTable('leave_balances', table => {
    table.increments('id').primary();
    table.integer('employee_id').unsigned().notNullable();
    table.integer('leave_type_id').unsigned().notNullable();
    table.integer('opening_balance').notNullable();
    table.integer('availed').defaultTo(0);
    table.integer('available').notNullable();
    table.integer('year').notNullable(); // e.g., 2025
    table.timestamps(true, true);

    table.foreign('employee_id').references('id').inTable('employees').onDelete('CASCADE');
    table.foreign('leave_type_id').references('id').inTable('leave_types').onDelete('CASCADE');
    table.unique(['employee_id', 'leave_type_id', 'year']);
  });
};

exports.down = function(knex) {
  return knex.schema.dropTable('leave_balances');
};