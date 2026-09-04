exports.up = async function (knex) {
  const hasColumn = await knex.schema.hasColumn(
    "employees",
    "subscription_billing_cycle",
  );

  if (!hasColumn) {
    await knex.schema.alterTable("employees", (table) => {
      table
        .enum("subscription_billing_cycle", ["monthly", "yearly"])
        .nullable()
        .defaultTo("monthly");
      table.index(
        ["company_id", "subscription_billing_cycle"],
        "employees_company_subscription_cycle_idx",
      );
    });
  }

  // Preserve the billing cycle of existing organizations where possible.
  await knex.raw(`
    UPDATE employees e
    SET e.subscription_billing_cycle = COALESCE(
      (
        SELECT cs.billing_cycle
        FROM company_subscriptions cs
        WHERE cs.company_id = e.company_id
          AND cs.status IN ('active', 'trial')
        ORDER BY cs.created_at DESC
        LIMIT 1
      ),
      'monthly'
    )
    WHERE e.subscription_billing_cycle IS NULL
  `);
};

exports.down = async function (knex) {
  const hasColumn = await knex.schema.hasColumn(
    "employees",
    "subscription_billing_cycle",
  );
  if (!hasColumn) return;

  await knex.schema.alterTable("employees", (table) => {
    table.dropIndex(
      ["company_id", "subscription_billing_cycle"],
      "employees_company_subscription_cycle_idx",
    );
    table.dropColumn("subscription_billing_cycle");
  });
};
