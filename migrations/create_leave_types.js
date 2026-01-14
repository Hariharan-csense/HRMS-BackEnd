exports.up = function(knex) {
  return knex.schema.createTable('leave_types', table => {
    table.increments('id').primary();
    table.string('leave_type_id').unique().notNullable(); // LT001
    table.string('name').notNullable().unique();
    table.boolean('is_paid').defaultTo(true);
    table.integer('annual_limit').notNullable();
    table.integer('carry_forward').defaultTo(0);
    table.boolean('encashable').defaultTo(false);
    table.text('description').nullable();
    table.enum('status', ['active', 'inactive']).defaultTo('active');
    table.timestamps(true, true);
  });
};

exports.down = function(knex) {
  return knex.schema.dropTable('leave_types');
};