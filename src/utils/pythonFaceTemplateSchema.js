const REQUIRED_COLUMNS = ["company_id", "model_name", "model_version", "source_photo"];

async function requirePythonFaceSchema(knex) {
  const exists = await knex.schema.hasTable("face_templates");
  const columns = exists ? await knex("face_templates").columnInfo() : {};
  const missing = REQUIRED_COLUMNS.filter((name) => !columns[name]);
  if (!exists || missing.length) {
    const error = new Error("Facial attendance database setup is incomplete. Ask your administrator to apply the Python face-template migration, then enroll existing employee photos. Python does not need to be reinstalled.");
    error.code = "FACE_TEMPLATE_SCHEMA_MISSING";
    error.statusCode = 503;
    error.missingColumns = missing;
    throw error;
  }
  return columns;
}

// Each engine owns its active rows. A stale legacy scanner must never deactivate
// Python enrollment when it rebuilds its own cache after a Node deployment.
function activeTemplatesForEngine(knex, employeeId, engine, hasModelName = true) {
  const query = knex("face_templates").where({ employee_id: employeeId, is_active: true });
  if (hasModelName) {
    if (engine === "python") query.where("model_name", "insightface");
    else query.andWhere((qb) => qb.whereNull("model_name").orWhere("model_name", "face-api.js"));
  }
  return query;
}

module.exports = { REQUIRED_COLUMNS, requirePythonFaceSchema, activeTemplatesForEngine };
