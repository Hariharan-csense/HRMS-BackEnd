// migrations/add_remarks_to_tickets.js
exports.up = async function(knex) {
  const hasColumn = await knex.schema.hasColumn('tickets', 'remarks');
  if (hasColumn) return;

  await knex.schema.alterTable('tickets', function(table) {
    table.text('remarks').nullable().after('description');
  });
};

exports.down = async function(knex) {
  const hasColumn = await knex.schema.hasColumn('tickets', 'remarks');
  if (!hasColumn) return;

  await knex.schema.alterTable('tickets', function(table) {
    table.dropColumn('remarks');
  });
};
