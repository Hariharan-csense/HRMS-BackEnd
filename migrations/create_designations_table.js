// db/migrations/xxxx_create_designations_table.js
exports.up = async function(knex) {
  const exists = await knex.schema.hasTable('designations');
  if (exists) return;

  await knex.schema.createTable('designations', table => {
    table.increments('id').primary();
    table.string('desg_id').unique().notNullable(); // DESG001
    table.string('name').notNullable().unique();    // e.g., Software Engineer
    table.string('level_grade').notNullable();      // e.g., L1, Senior, Manager
    table.text('description').nullable();
    table.timestamps(true, true);
  });
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('designations');
};
