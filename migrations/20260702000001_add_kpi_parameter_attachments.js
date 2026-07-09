exports.up = async function (knex) {
  const hasTable = await knex.schema.hasTable("kpi_parameters");
  if (!hasTable) return;

  const hasAttachmentPath = await knex.schema.hasColumn(
    "kpi_parameters",
    "attachment_path",
  );
  if (!hasAttachmentPath) {
    await knex.schema.alterTable("kpi_parameters", (table) => {
      table.string("attachment_path").nullable();
      table.string("attachment_name").nullable();
    });
  }
};

exports.down = async function (knex) {
  const hasTable = await knex.schema.hasTable("kpi_parameters");
  if (!hasTable) return;

  const hasAttachmentPath = await knex.schema.hasColumn(
    "kpi_parameters",
    "attachment_path",
  );
  if (hasAttachmentPath) {
    await knex.schema.alterTable("kpi_parameters", (table) => {
      table.dropColumn("attachment_path");
      table.dropColumn("attachment_name");
    });
  }
};
