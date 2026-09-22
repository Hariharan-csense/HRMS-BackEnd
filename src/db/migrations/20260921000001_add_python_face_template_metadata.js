exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable("face_templates"))) {
    await require("./create_face_templates_table").up(knex);
  }

  const columns = await knex("face_templates").columnInfo();
  await knex.schema.alterTable("face_templates", (table) => {
    if (!columns.company_id) table.integer("company_id").unsigned().nullable();
    if (!columns.model_name) table.string("model_name", 100).nullable();
    if (!columns.model_version) table.string("model_version", 150).nullable();
    if (!columns.source_photo) table.string("source_photo", 512).nullable();
  });

  await knex("face_templates")
    .join("employees", "employees.id", "face_templates.employee_id")
    .whereNull("face_templates.company_id")
    .update({ "face_templates.company_id": knex.ref("employees.company_id") });

  const [indexes] = await knex.raw("SHOW INDEX FROM face_templates WHERE Key_name = ?", ["face_templates_company_model_active_idx"]);
  if (!indexes.length) {
    await knex.schema.alterTable("face_templates", (table) => {
      table.index(["company_id", "model_version", "is_active"], "face_templates_company_model_active_idx");
    });
  }
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable("face_templates"))) return;
  const columns = await knex("face_templates").columnInfo();
  const [indexes] = await knex.raw("SHOW INDEX FROM face_templates WHERE Key_name = ?", ["face_templates_company_model_active_idx"]);
  if (indexes.length) await knex.schema.alterTable("face_templates", (table) => table.dropIndex([], "face_templates_company_model_active_idx"));
  await knex.schema.alterTable("face_templates", (table) => {
    if (columns.source_photo) table.dropColumn("source_photo");
    if (columns.model_version) table.dropColumn("model_version");
    if (columns.model_name) table.dropColumn("model_name");
    if (columns.company_id) table.dropColumn("company_id");
  });
};
