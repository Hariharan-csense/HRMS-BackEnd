exports.up = async function (knex) {
  const hasTable = await knex.schema.hasTable("company_addon_user_assignments");
  if (hasTable) return;

  await knex.schema.createTable(
    "company_addon_user_assignments",
    function (table) {
      table.increments("id").primary();
      table.integer("company_id").unsigned().notNullable();
      table.integer("subscription_addon_id").unsigned().notNullable();
      table.integer("addon_id").unsigned().notNullable();
      table.integer("employee_id").unsigned().notNullable();
      table.string("module_key").notNullable();
      table.timestamps(true, true);

      table
        .foreign("company_id")
        .references("id")
        .inTable("companies")
        .onDelete("CASCADE");
      table
        .foreign("subscription_addon_id")
        .references("id")
        .inTable("company_subscription_addons")
        .onDelete("CASCADE");
      table
        .foreign("addon_id")
        .references("id")
        .inTable("subscription_addons")
        .onDelete("CASCADE");
      table
        .foreign("employee_id")
        .references("id")
        .inTable("employees")
        .onDelete("CASCADE");
      table.unique(["subscription_addon_id", "employee_id"]);
    },
  );
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists("company_addon_user_assignments");
};
