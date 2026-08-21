// db/migrations/xxxx_create_companies_table.js
exports.up = async function(knex) {
  const exists = await knex.schema.hasTable('companies');
  if (exists) return;

  await knex.schema.createTable('companies', table => {
    table.increments('id').primary(); // auto increment integer id
    table.string('company_id').unique().notNullable(); // CMP001, CMP002...
    table.string('company_name').notNullable();
    table.string('legal_name').notNullable();
    table.string('gstin_pan').unique().notNullable();
    table.string('industry');
    table.string('timezone').defaultTo('IST');
    table.string('payroll_cycle').defaultTo('Monthly');
    table.text('address');
    table.timestamps(true, true);
  });
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('companies');
};
