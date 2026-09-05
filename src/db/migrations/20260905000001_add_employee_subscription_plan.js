exports.up = async function (knex) {
  const hasColumn = await knex.schema.hasColumn("employees", "subscription_plan_id");

  if (!hasColumn) {
    await knex.schema.alterTable("employees", (table) => {
      table.integer("subscription_plan_id").unsigned().nullable();
      table
        .foreign("subscription_plan_id")
        .references("id")
        .inTable("subscription_plans")
        .onDelete("SET NULL");
      table.index(
        ["company_id", "subscription_plan_id", "subscription_billing_cycle"],
        "employees_company_plan_cycle_idx",
      );
    });
  }

  // Preserve existing assignments by matching each employee's billing cycle.
  await knex.raw(`
    UPDATE employees e
    SET e.subscription_plan_id = (
      SELECT cs.plan_id
      FROM company_subscriptions cs
      WHERE cs.company_id = e.company_id
        AND cs.billing_cycle = COALESCE(e.subscription_billing_cycle, 'monthly')
        AND cs.status IN ('active', 'trial')
      ORDER BY cs.created_at DESC
      LIMIT 1
    )
    WHERE e.subscription_plan_id IS NULL
  `);
};

exports.down = async function (knex) {
  const hasColumn = await knex.schema.hasColumn("employees", "subscription_plan_id");
  if (!hasColumn) return;

  await knex.schema.alterTable("employees", (table) => {
    table.dropIndex(
      ["company_id", "subscription_plan_id", "subscription_billing_cycle"],
      "employees_company_plan_cycle_idx",
    );
    table.dropForeign("subscription_plan_id");
    table.dropColumn("subscription_plan_id");
  });
};
