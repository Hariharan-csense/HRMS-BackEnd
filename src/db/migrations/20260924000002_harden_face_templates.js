exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable("face_templates"))) return;
  const columns = await knex("face_templates").columnInfo();
  if (!columns.company_id || !columns.model_name || !columns.model_version) {
    throw new Error("Apply the Python face-template metadata migration first");
  }
  await knex("face_templates")
    .join("employees", "employees.id", "face_templates.employee_id")
    .whereNull("face_templates.company_id")
    .update({ "face_templates.company_id": knex.ref("employees.company_id") });
  await knex.schema.alterTable("face_templates", (table) => {
    table.index(
      ["company_id", "employee_id", "model_name", "model_version", "is_active"],
      "face_templates_tenant_employee_model_idx",
    );
  });
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable("face_templates"))) return;
  const [indexes] = await knex.raw(
    "SHOW INDEX FROM face_templates WHERE Key_name = ?",
    ["face_templates_tenant_employee_model_idx"],
  );
  await knex.schema.alterTable("face_templates", (table) => {
    if (indexes.length) table.dropIndex([], "face_templates_tenant_employee_model_idx");
  });
};
