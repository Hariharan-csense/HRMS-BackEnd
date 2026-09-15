exports.up = async function (knex) {
  const hasSubscriptions = await knex.schema.hasTable("company_subscriptions");
  if (!hasSubscriptions || !(await knex.schema.hasColumn("company_subscriptions", "max_users"))) {
    return;
  }

  await knex("company_subscriptions")
    .where("status", "trial")
    .where("max_users", 999)
    .update({ max_users: 25, updated_at: knex.fn.now() });
};

exports.down = async function () {
  // Do not restore the old unlimited trial-seat value.
};
