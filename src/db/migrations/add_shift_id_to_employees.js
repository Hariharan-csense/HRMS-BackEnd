exports.up = async function(knex) {
  const hasColumn = await knex.schema.hasColumn('employees', 'shift_id');
  if (hasColumn) return;

  await knex.schema.table('employees', table => {
    table.integer('shift_id').unsigned().nullable();
  });
};

exports.down = async function(knex) {
  const hasColumn = await knex.schema.hasColumn('employees', 'shift_id');
  if (!hasColumn) return;

  await knex.schema.table('employees', function(table) {
    table.dropColumn('shift_id');
  });
};
