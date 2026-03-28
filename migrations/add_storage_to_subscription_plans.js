exports.up = function(knex) {
  return knex.schema
    // Add storage field to subscription_plans
    .table('subscription_plans', function(table) {
      table.integer('storage_gb').defaultTo(1).after('max_users'); // Storage in GB
    })
    // Add storage tracking to company_subscriptions
    .table('company_subscriptions', function(table) {
      table.integer('storage_gb').defaultTo(1).after('max_users'); // Storage limit in GB
      table.integer('used_storage_mb').defaultTo(0).after('storage_gb'); // Used storage in MB
    });
};

exports.down = function(knex) {
  return knex.schema
    .table('company_subscriptions', function(table) {
      table.dropColumn('used_storage_mb');
      table.dropColumn('storage_gb');
    })
    .table('subscription_plans', function(table) {
      table.dropColumn('storage_gb');
    });
};
