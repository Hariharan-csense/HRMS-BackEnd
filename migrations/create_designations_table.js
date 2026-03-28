// db/migrations/xxxx_create_designations_table.js
exports.up = function(knex) {
  return knex.schema.createTable('designations', table => {
    table.increments('id').primary();
    table.string('desg_id').unique().notNullable(); // DESG001
    table.string('name').notNullable().unique();    // e.g., Software Engineer
    table.string('level_grade').notNullable();      // e.g., L1, Senior, Manager
    table.text('description').nullable();
    table.timestamps(true, true);
  });
};

exports.down = function(knex) {
  return knex.schema.dropTable('designations');
};