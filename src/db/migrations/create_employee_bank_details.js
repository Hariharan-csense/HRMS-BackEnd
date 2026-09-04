exports.up = async function(knex) {
  const exists = await knex.schema.hasTable('employee_bank_details');
  if (exists) return;

  await knex.schema.createTable('employee_bank_details', table => {
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

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('employee_bank_details');
};
