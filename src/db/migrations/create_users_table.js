// db/migrations/xxxx_create_users_table.js
exports.up = async function(knex) {
  const exists = await knex.schema.hasTable('users');
  if (exists) return;

  await knex.schema.createTable('users', table => {
    table.increments('id').primary();
    table.string('name').notNullable();
    table.string('email').unique().notNullable();
    table.string('password').notNullable(); // Will store hashed password
    table.string('department');
    table.string('role').defaultTo('employee'); // employee, manager, hr, finance, admin
    table.string('avatar').nullable();
    table.timestamps(true, true);
  });
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('users');
};
