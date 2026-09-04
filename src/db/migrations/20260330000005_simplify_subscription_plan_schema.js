exports.up = async function (knex) {
  const hasYearlyPrice = await knex.schema.hasColumn('subscription_plans', 'yearly_price');

  if (!hasYearlyPrice) {
    await knex.schema.table('subscription_plans', function (table) {
      table.decimal('yearly_price', 10, 2).nullable();
    });
  }

  const legacyYearlyColumns = [
    'yearly_price_upto25',
    'yearly_price_upto50',
    'yearly_price_above50'
  ];

  for (const column of legacyYearlyColumns) {
    const hasColumn = await knex.schema.hasColumn('subscription_plans', column);
    if (hasColumn) {
      await knex('subscription_plans')
        .whereNull('yearly_price')
        .update({
          yearly_price: knex.ref(column)
        });
    }
  }

  await knex('subscription_plans')
    .whereNull('yearly_price')
    .update({
      yearly_price: knex.ref('price')
    });

  const removableColumns = [
    'billing_cycle',
    'price_upto25',
    'price_upto50',
    'price_above50',
    'yearly_price_upto25',
    'yearly_price_upto50',
    'yearly_price_above50'
  ];

  for (const column of removableColumns) {
    const hasColumn = await knex.schema.hasColumn('subscription_plans', column);
    if (hasColumn) {
      await knex.schema.table('subscription_plans', function (table) {
        table.dropColumn(column);
      });
    }
  }
};

exports.down = async function () {
  // Intentionally left empty because the simplified plan schema is the new source of truth.
};
