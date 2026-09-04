exports.up = async function up(knex) {
  const hasClientId = await knex.schema.hasColumn('expenses', 'client_id');
  if (!hasClientId) {
    await knex.schema.alterTable('expenses', (table) => {
      table.integer('client_id').unsigned().nullable().index();
    });
  }
};

exports.down = async function down(knex) {
  const hasClientId = await knex.schema.hasColumn('expenses', 'client_id');
  if (hasClientId) {
    await knex.schema.alterTable('expenses', (table) => {
      table.dropColumn('client_id');
    });
  }
};

