exports.up = function(knex) {
  return knex.schema.createTable('leave_applications', table => {
    table.increments('id').primary();
    table.string('application_id').unique().notNullable(); // LA001
    table.integer('employee_id').unsigned().notNullable();
    table.string('employee_name').notNullable();
    table.integer('leave_type_id').unsigned().notNullable();
    table.string('leave_type_name').notNullable();
    table.date('from_date').notNullable();
    table.date('to_date').notNullable();
    table.integer('days').notNullable();
    table.text('reason').notNullable();
    table.string('attachment_path').nullable();
    table.enum('status', ['pending', 'approved', 'rejected']).defaultTo('pending');
    table.integer('approved_by').unsigned().nullable();
    table.timestamp('approved_at').nullable();
    table.text('remarks').nullable();
    table.timestamps(true, true);

    table.foreign('employee_id').references('id').inTable('employees');
    table.foreign('leave_type_id').references('id').inTable('leave_types');
    table.foreign('approved_by').references('id').inTable('employees');
  });
};

exports.down = function(knex) {
  return knex.schema.dropTable('leave_applications');
};