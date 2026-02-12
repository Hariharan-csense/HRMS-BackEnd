// db/migrations/xxxx_create_branches_table.js
exports.up = function(knex) {
  return knex.schema.createTable('branches', table => {
    table.increments('id').primary();
    table.string('branch_id').unique().notNullable(); // BR001
    table.string('name').notNullable();
    table.text('address').notNullable();
    table.string('coordinates').notNullable(); // "12.9716,77.5946"
    table.decimal('latitude', 10, 8).notNullable();
    table.decimal('longitude', 10, 8).notNullable();
    table.integer('radius').notNullable(); // in meters, e.g., 100
    table.timestamps(true, true);
  });
};

exports.down = function(knex) {
  return knex.schema.dropTable('branches');
};