const knex = require("../db/db");
const { warmEmployeeFaceDescriptor } = require("../utils/faceRecognition");
const { requirePythonFaceSchema } = require("../utils/pythonFaceTemplateSchema");
const python = require("../services/pythonFaceService");

const migrate = async () => {
  await requirePythonFaceSchema(knex);
  if (process.env.FACE_RECOGNITION_ENGINE === "legacy") throw new Error("Set FACE_RECOGNITION_ENGINE=python before Python enrollment");
  const health = await python.health();
  if (!health.model_loaded || !health.model_version) throw new Error("Python face service model is not ready");
  const force = process.argv.includes("--force");
  const existing = await knex("face_templates").where({ is_active: true, model_name: "insightface", model_version: health.model_version }).select("employee_id");
  const enrolled = new Set(existing.map((row) => Number(row.employee_id)));
  const employees = await knex("employees")
    .whereNotNull("company_id")
    .whereRaw("LOWER(TRIM(COALESCE(status, 'active'))) = 'active'")
    .select("id", "company_id")
    .orderBy("id");
  let ready = 0;
  let skipped = 0;
  let alreadyReady = 0;

  for (const employee of employees) {
    if (!force && enrolled.has(Number(employee.id))) { alreadyReady += 1; continue; }
    const result = await warmEmployeeFaceDescriptor(
      employee.id,
      employee.company_id,
    );
    if (result.ready) ready += 1;
    else {
      skipped += 1;
      console.warn(
        `Face enrollment skipped for employee ${employee.id}: ${result.reason}`,
      );
    }
  }

  console.log(
    `Face template migration complete: ${ready} newly enrolled, ${alreadyReady} already enrolled, ${skipped} failed or missing photos`,
  );
  if (skipped) process.exitCode = 1;
};

migrate()
  .catch((error) => {
    console.error("Face template migration failed:", error);
    process.exitCode = 1;
  })
  .finally(() => knex.destroy());
