exports.up = async function(knex) {
  const hasClientId = await knex.schema.hasColumn('attendance', 'client_id');
  if (!hasClientId) {
    await knex.schema.alterTable('attendance', function(table) {
      table.integer('client_id').unsigned().nullable().index();
    });
  }
};

exports.down = async function(knex) {
  const hasClientId = await knex.schema.hasColumn('attendance', 'client_id');
  if (hasClientId) {
    await knex.schema.alterTable('attendance', function(table) {
      table.dropColumn('client_id');
    });
  }
};
