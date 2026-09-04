exports.up = async function (knex) {
  const hasAddonsTable = await knex.schema.hasTable('subscription_addons');
  if (!hasAddonsTable) return;

  const hasModuleKey = await knex.schema.hasColumn('subscription_addons', 'module_key');
  if (!hasModuleKey) {
    await knex.schema.table('subscription_addons', function (table) {
      table.string('module_key').nullable().after('description');
    });
  }
};

exports.down = async function (knex) {
  const hasAddonsTable = await knex.schema.hasTable('subscription_addons');
  if (!hasAddonsTable) return;

  const hasModuleKey = await knex.schema.hasColumn('subscription_addons', 'module_key');
  if (hasModuleKey) {
    await knex.schema.table('subscription_addons', function (table) {
      table.dropColumn('module_key');
    });
  }
};
