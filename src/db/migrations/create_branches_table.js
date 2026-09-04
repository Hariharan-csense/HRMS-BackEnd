// db/migrations/xxxx_create_branches_table.js
exports.up = async function(knex) {
  const exists = await knex.schema.hasTable('branches');
  if (exists) return;

  await knex.schema.createTable('branches', table => {
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

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('branches');
};
