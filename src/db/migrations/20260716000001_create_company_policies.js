exports.up = async function(knex) {
  const exists = await knex.schema.hasTable("company_policies");
  if (exists) return;

  await knex.schema.createTable("company_policies", (table) => {
    table.increments("id").primary();
    table.integer("company_id").unsigned().notNullable().unique();
    table.text("leave_policy").nullable();
    table.text("permission_policy").nullable();
    table.text("attendance_policy").nullable();
    table.text("expense_policy").nullable();
    table.timestamps(true, true);

    table
      .foreign("company_id")
      .references("id")
      .inTable("companies")
      .onDelete("CASCADE");
  });
};

exports.down = async function(knex) {
  const exists = await knex.schema.hasTable("company_policies");
  if (exists) {
    await knex.schema.dropTable("company_policies");
  }
};
