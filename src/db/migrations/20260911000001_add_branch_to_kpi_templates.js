exports.up = async function (knex) {
  const hasTemplates = await knex.schema.hasTable("kpi_templates");
  if (!hasTemplates || (await knex.schema.hasColumn("kpi_templates", "branch_id"))) {
    return;
  }

  await knex.schema.table("kpi_templates", function (table) {
    table.integer("branch_id").unsigned().nullable().index();
  });
};

exports.down = async function (knex) {
  const hasTemplates = await knex.schema.hasTable("kpi_templates");
  if (hasTemplates && (await knex.schema.hasColumn("kpi_templates", "branch_id"))) {
    await knex.schema.table("kpi_templates", function (table) {
      table.dropColumn("branch_id");
    });
  }
};
