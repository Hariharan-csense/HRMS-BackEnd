exports.up = async function up(knex) {
  const exists = await knex.schema.hasTable("notifications");
  if (!exists) return;

  const hasCompanyId = await knex.schema.hasColumn("notifications", "company_id");
  if (!hasCompanyId) {
    await knex.schema.alterTable("notifications", (table) => {
      table.bigInteger("company_id").unsigned().nullable().index();
      table.index(["company_id", "user_id", "read"], "notifications_company_user_read_idx");
    });
  }
};

exports.down = async function down(knex) {
  const exists = await knex.schema.hasTable("notifications");
  if (!exists) return;

  const hasCompanyId = await knex.schema.hasColumn("notifications", "company_id");
  if (hasCompanyId) {
    await knex.schema.alterTable("notifications", (table) => {
      table.dropIndex(["company_id", "user_id", "read"], "notifications_company_user_read_idx");
      table.dropColumn("company_id");
    });
  }
};
