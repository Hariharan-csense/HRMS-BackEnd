exports.up = async function (knex) {
  const hasTable = await knex.schema.hasTable("kpi_parameter_reviews");
  if (!hasTable) return;

  const hasSubmittedAt = await knex.schema.hasColumn(
    "kpi_parameter_reviews",
    "submitted_at",
  );
  if (!hasSubmittedAt) {
    await knex.schema.table("kpi_parameter_reviews", function (table) {
      table.timestamp("submitted_at").nullable();
      table.index(["submitted_at"], "idx_kpi_reviews_submitted_at");
      table.index(
        ["kpi_template_id", "submitted_at"],
        "idx_kpi_reviews_template_submitted",
      );
    });
  }
};

exports.down = async function (knex) {
  const hasTable = await knex.schema.hasTable("kpi_parameter_reviews");
  if (!hasTable) return;

  const hasSubmittedAt = await knex.schema.hasColumn(
    "kpi_parameter_reviews",
    "submitted_at",
  );
  if (hasSubmittedAt) {
    await knex.schema.table("kpi_parameter_reviews", function (table) {
      table.dropIndex(["submitted_at"], "idx_kpi_reviews_submitted_at");
      table.dropIndex(
        ["kpi_template_id", "submitted_at"],
        "idx_kpi_reviews_template_submitted",
      );
      table.dropColumn("submitted_at");
    });
  }
};

