exports.up = async function(knex) {
  const hasCompanyId = await knex.schema.hasColumn('leave_types', 'company_id');
  if (hasCompanyId) return;
  return knex.schema.alterTable('leave_types', table => {
    table.integer('company_id').unsigned().notNullable().after('id');
    table.foreign('company_id').references('id').inTable('companies');
  });
};

exports.down = async function(knex) {
  const hasCompanyId = await knex.schema.hasColumn('leave_types', 'company_id');
  if (!hasCompanyId) return;
  return knex.schema.alterTable('leave_types', table => {
    table.dropForeign('company_id');
    table.dropColumn('company_id');
  });
};
