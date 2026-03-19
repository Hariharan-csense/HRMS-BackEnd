exports.up = async function up(knex) {
  const exists = await knex.schema.hasTable('expense_drafts');
  if (exists) return;

  await knex.schema.createTable('expense_drafts', (table) => {
    table.increments('id').primary();
    table.integer('company_id').unsigned().notNullable().index();
    table.integer('employee_id').unsigned().notNullable().index();
    table.integer('client_id').unsigned().nullable().index();
    table.text('draft_data', 'longtext').notNullable(); // JSON string
    table.timestamps(true, true);

    table.unique(['company_id', 'employee_id']);
  });
};

exports.down = async function down(knex) {
  const exists = await knex.schema.hasTable('expense_drafts');
  if (!exists) return;
  await knex.schema.dropTable('expense_drafts');
};

