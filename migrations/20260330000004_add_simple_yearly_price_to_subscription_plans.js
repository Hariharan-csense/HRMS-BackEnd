exports.up = async function (knex) {
  const hasYearlyPrice = await knex.schema.hasColumn('subscription_plans', 'yearly_price');
  const hasLegacyYearlyPrice = await knex.schema.hasColumn('subscription_plans', 'yearly_price_upto25');

  if (!hasYearlyPrice) {
    await knex.schema.table('subscription_plans', function (table) {
      table.decimal('yearly_price', 10, 2).nullable();
    });
  }

  if (hasLegacyYearlyPrice) {
    await knex('subscription_plans')
      .whereNull('yearly_price')
      .update({
        yearly_price: knex.ref('yearly_price_upto25')
      });
  }

  await knex('subscription_plans')
    .whereNull('yearly_price')
    .update({
      yearly_price: knex.ref('price')
    });
};

exports.down = async function (knex) {
  const hasYearlyPrice = await knex.schema.hasColumn('subscription_plans', 'yearly_price');

  if (hasYearlyPrice) {
    await knex.schema.table('subscription_plans', function (table) {
      table.dropColumn('yearly_price');
    });
  }
};
