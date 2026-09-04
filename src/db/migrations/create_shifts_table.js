exports.up = function(knex) {
  return knex.schema.createTable('shifts', table => {
    table.increments('id').primary();
    table.string('name').notNullable(); // Morning, Afternoon, Night
    table.time('start_time').notNullable();
    table.time('end_time').notNullable();
    table.string('description').nullable();
    table.enum('status', ['Active', 'Inactive']).defaultTo('Active');
    table.timestamps(true, true);
  });
};

exports.down = function(knex) {
  return knex.schema.dropTable('shifts');
};
