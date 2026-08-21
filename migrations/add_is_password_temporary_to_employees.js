exports.up = async function(knex) {
  const hasColumn = await knex.schema.hasColumn('employees', 'is_password_temporary');
  if (hasColumn) return;

  await knex.schema.alterTable('employees', table => {
    table.boolean('is_password_temporary').defaultTo(true).after('password');
  });
};

exports.down = async function(knex) {
  const hasColumn = await knex.schema.hasColumn('employees', 'is_password_temporary');
  if (!hasColumn) return;

  await knex.schema.alterTable('employees', table => {
    table.dropColumn('is_password_temporary');
  });
};
