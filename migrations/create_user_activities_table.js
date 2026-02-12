exports.up = function(knex) {
  return knex.schema.createTable('user_activities', table => {
    table.increments('id').primary();
    table.integer('employee_id').unsigned().notNullable();
    table.string('action').notNullable(); // 'Logged in', 'Updated Profile', 'Changed Password', etc.
    table.string('location').defaultTo('Unknown');
    table.string('ip_address').defaultTo(null);
    table.string('user_agent').defaultTo(null);
    table.timestamps(true, true);

    table.foreign('employee_id').references('id').inTable('employees').onDelete('CASCADE');
  });
};

exports.down = function(knex) {
  return knex.schema.dropTable('user_activities');
};
