exports.up = async function (knex) {
  const hasBillingCycle = await knex.schema.hasColumn(
    'company_subscriptions',
    'billing_cycle'
  );
  const hasSubscriptionAddons = await knex.schema.hasTable('subscription_addons');
  const hasCompanySubscriptionAddons = await knex.schema.hasTable(
    'company_subscription_addons'
  );

  if (!hasBillingCycle) {
    await knex.schema.table('company_subscriptions', function (table) {
      table.string('billing_cycle').nullable();
    });
  }

  if (!hasSubscriptionAddons) {
    await knex.schema.createTable('subscription_addons', function (table) {
      table.increments('id').primary();
      table.string('name').notNullable();
      table.text('description');
      table.decimal('price_upto25', 10, 2).notNullable();
      table.decimal('price_upto50', 10, 2).notNullable();
      table.decimal('price_above50', 10, 2).notNullable();
      table.boolean('is_active').defaultTo(true);
      table.timestamps(true, true);
    });
  }

  if (!hasCompanySubscriptionAddons) {
    await knex.schema.createTable('company_subscription_addons', function (table) {
      table.increments('id').primary();
      table.integer('subscription_id').unsigned().notNullable();
      table.integer('addon_id').unsigned().notNullable();
      table.integer('users_count').notNullable();
      table.string('billing_cycle').notNullable();
      table.decimal('price_per_user', 10, 2).notNullable();
      table.decimal('total_price', 10, 2).notNullable();
      table.timestamps(true, true);

      table
        .foreign('subscription_id')
        .references('id')
        .inTable('company_subscriptions')
        .onDelete('CASCADE');
      table
        .foreign('addon_id')
        .references('id')
        .inTable('subscription_addons')
        .onDelete('CASCADE');
    });
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('company_subscription_addons');
  await knex.schema.dropTableIfExists('subscription_addons');

  const hasBillingCycle = await knex.schema.hasColumn(
    'company_subscriptions',
    'billing_cycle'
  );

  if (hasBillingCycle) {
    await knex.schema.table('company_subscriptions', function (table) {
      table.dropColumn('billing_cycle');
    });
  }
};
