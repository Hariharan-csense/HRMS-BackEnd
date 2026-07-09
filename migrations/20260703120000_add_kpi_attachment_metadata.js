exports.up = async function (knex) {
  const hasTable = await knex.schema.hasTable("kpi_parameters");
  if (!hasTable) return;

  const hasUploadedBy = await knex.schema.hasColumn(
    "kpi_parameters",
    "attachment_uploaded_by_name",
  );
  if (!hasUploadedBy) {
    await knex.schema.alterTable("kpi_parameters", (table) => {
      table.string("attachment_uploaded_by_name").nullable();
      table.timestamp("attachment_uploaded_at").nullable();
    });
  }
};

exports.down = async function (knex) {
  const hasTable = await knex.schema.hasTable("kpi_parameters");
  if (!hasTable) return;

  const hasUploadedBy = await knex.schema.hasColumn(
    "kpi_parameters",
    "attachment_uploaded_by_name",
  );
  if (hasUploadedBy) {
    await knex.schema.alterTable("kpi_parameters", (table) => {
      table.dropColumn("attachment_uploaded_by_name");
      table.dropColumn("attachment_uploaded_at");
    });
  }
};
