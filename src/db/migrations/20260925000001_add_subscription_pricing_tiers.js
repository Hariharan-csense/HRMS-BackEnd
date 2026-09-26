exports.up = async function (knex) {
  for (const name of ["subscription_plans", "subscription_addons"]) {
    if (!(await knex.schema.hasColumn(name, "pricing_tiers"))) {
      await knex.schema.alterTable(name, (table) =>
        table.json("pricing_tiers").nullable(),
      );
    }
  }
};
exports.down = async function (knex) {
  for (const name of ["subscription_plans", "subscription_addons"]) {
    if (await knex.schema.hasColumn(name, "pricing_tiers"))
      await knex.schema.alterTable(name, (table) =>
        table.dropColumn("pricing_tiers"),
      );
  }
};
