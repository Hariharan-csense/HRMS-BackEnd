// db/migrations/xxxx_create_clients_table.js
exports.up = async function(knex) {
  const exists = await knex.schema.hasTable('clients');
  if (exists) return;

  await knex.schema.createTable('clients', table => {
    table.increments('id').primary();
    table.string('client_id').unique().notNullable(); // CLI001, CLI002...
    table.string('client_name').notNullable();
    table.string('contact_person');
    table.string('email');
    table.string('phone');
    table.string('industry');
    table.text('address');
    table.string('status').defaultTo('active'); // active, inactive
    table.integer('company_id').unsigned().references('id').inTable('companies').onDelete('CASCADE');
    table.integer('assigned_to').unsigned().references('id').inTable('employees').onDelete('SET NULL');
    table.timestamps(true, true);
  });
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('clients');
};
