exports.up = function(knex) {
  return knex.schema.createTable('employee_bank_details', table => {
    table.increments('id').primary();
    table.integer('employee_id').unsigned().notNullable();
    table.string('account_holder_name');
    table.string('bank_name');
    table.string('account_number');
    table.string('ifsc_code');
    table.timestamps(true, true);

    table.foreign('employee_id').references('id').inTable('employees').onDelete('CASCADE');
    table.unique('employee_id'); // one bank detail per employee
  });
};

exports.down = function(knex) {
  return knex.schema.dropTable('employee_bank_details');
};