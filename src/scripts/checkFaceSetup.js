const knex = require("../db/db");
const { requirePythonFaceSchema } = require("../utils/pythonFaceTemplateSchema");
const python = require("../services/pythonFaceService");
const { uploadRoot } = require("../utils/uploadPaths");
const fs = require("fs");

(async () => {
  // Never print credentials, face embeddings, tokens or employee details.
  console.log("Database target:", JSON.stringify({ host: process.env.DB_HOST, database: process.env.DB_NAME }));
  console.log("Engine:", process.env.FACE_RECOGNITION_ENGINE || "python");
  console.log("Upload directory exists:", fs.existsSync(uploadRoot), uploadRoot);
  await requirePythonFaceSchema(knex);
  console.log("Python template schema: ready");
  const rows = await knex("face_templates as ft").join("employees as e", "e.id", "ft.employee_id")
    .where("ft.model_name", "insightface").whereNotNull("ft.model_version").where("ft.is_active", true)
    .select("e.company_id", "ft.model_version").count({ active_templates: "*" }).groupBy("e.company_id", "ft.model_version");
  console.log("Active Python enrollment counts:", JSON.stringify(rows));
  const health = await python.health();
  console.log("Python service:", JSON.stringify(health));
  if (!health.model_loaded) throw new Error("Python service is running but its model is not loaded");
  if (!rows.length) throw new Error("No Python templates are enrolled. Run face:migrate:prod once on the server with the existing photos.");
})().catch((error) => {
  console.error(error.code || "FACE_SETUP_CHECK_FAILED", error.message);
  if (error.missingColumns) console.error("Missing columns:", error.missingColumns.join(", "));
  process.exitCode = 1;
}).finally(() => knex.destroy());
