exports.up = async function(knex) {
  const hasCompanyId = await knex.schema.hasColumn('roles', 'company_id');
  if (hasCompanyId) return;
  return knex.schema.alterTable('roles', table => {
    table.integer('company_id').unsigned().notNullable().after('id');
    table.foreign('company_id').references('id').inTable('companies');
    
    // Drop the old unique constraint on name since it should be unique per company
    table.dropUnique(['name']);
    
    // Add composite unique constraint for name within company
    table.unique(['name', 'company_id']);
  });
};

exports.down = async function(knex) {
  const hasCompanyId = await knex.schema.hasColumn('roles', 'company_id');
  if (!hasCompanyId) return;
  return knex.schema.alterTable('roles', table => {
    table.dropForeign('company_id');
    table.dropColumn('company_id');
    
    // Restore old unique constraint
    table.dropUnique(['name', 'company_id']);
    table.unique(['name']);
  });
};
