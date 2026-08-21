exports.up = async function(knex) {
  const planHasStorage = await knex.schema.hasColumn('subscription_plans', 'storage_gb');
  const subscriptionHasStorage = await knex.schema.hasColumn('company_subscriptions', 'storage_gb');
  const subscriptionHasUsedStorage = await knex.schema.hasColumn('company_subscriptions', 'used_storage_mb');

  if (!planHasStorage) {
    await knex.schema.table('subscription_plans', function(table) {
      table.integer('storage_gb').defaultTo(1).after('max_users');
    });
  }

  if (!subscriptionHasStorage || !subscriptionHasUsedStorage) {
    await knex.schema.table('company_subscriptions', function(table) {
      if (!subscriptionHasStorage) table.integer('storage_gb').defaultTo(1).after('max_users');
      if (!subscriptionHasUsedStorage) table.integer('used_storage_mb').defaultTo(0).after('storage_gb');
    });
  }
};

exports.down = async function(knex) {
  const planHasStorage = await knex.schema.hasColumn('subscription_plans', 'storage_gb');
  const subscriptionHasStorage = await knex.schema.hasColumn('company_subscriptions', 'storage_gb');
  const subscriptionHasUsedStorage = await knex.schema.hasColumn('company_subscriptions', 'used_storage_mb');

  if (subscriptionHasStorage || subscriptionHasUsedStorage) {
    await knex.schema.table('company_subscriptions', function(table) {
      if (subscriptionHasUsedStorage) table.dropColumn('used_storage_mb');
      if (subscriptionHasStorage) table.dropColumn('storage_gb');
    });
  }

  if (planHasStorage) {
    await knex.schema.table('subscription_plans', function(table) {
      table.dropColumn('storage_gb');
    });
  }
};
