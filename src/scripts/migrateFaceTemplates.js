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
    .select("id", "company_id", "profile_photo")
    .orderBy("id");
  const employeeIdsWithPhotos = new Set(
    employees
      .filter((employee) => String(employee.profile_photo || "").trim())
      .map((employee) => Number(employee.id)),
  );
  if (await knex.schema.hasTable("employee_documents")) {
    const documentColumns = await knex("employee_documents").columnInfo();
    const photoDocuments = await knex("employee_documents")
      .whereNotNull("file_path")
      .whereIn("employee_id", employees.map((employee) => employee.id))
      .modify((query) => {
        if (documentColumns.type && documentColumns.fieldname) {
          query.whereRaw("LOWER(COALESCE(type, fieldname, '')) = 'photo'");
        } else if (documentColumns.type) query.whereRaw("LOWER(type) = 'photo'");
        else if (documentColumns.fieldname) query.whereRaw("LOWER(fieldname) = 'photo'");
        else query.whereRaw("1 = 0");
      })
      .distinct("employee_id");
    photoDocuments.forEach((row) => employeeIdsWithPhotos.add(Number(row.employee_id)));
  }
  let ready = 0;
  let skipped = 0;
  let alreadyReady = 0;
  const failures = {
    no_photo: 0,
    no_face: 0,
    multiple_faces: 0,
    invalid_or_low_quality: 0,
    service_or_other: 0,
  };

  for (const employee of employees) {
    if (!force && enrolled.has(Number(employee.id))) { alreadyReady += 1; continue; }
    const result = await warmEmployeeFaceDescriptor(
      employee.id,
      employee.company_id,
    );
    if (result.ready) ready += 1;
    else {
      skipped += 1;
      const reason = String(result.reason || "");
      if (!employee.profile_photo && /No employee photo|photo/i.test(reason)) failures.no_photo += 1;
      else if (/NO_FACE|No face/i.test(reason)) failures.no_face += 1;
      else if (/MULTIPLE_FACES|Multiple faces/i.test(reason)) failures.multiple_faces += 1;
      else if (/INVALID_IMAGE|LOW_IMAGE_QUALITY|FACE_TOO_SMALL|quality/i.test(reason)) failures.invalid_or_low_quality += 1;
      else failures.service_or_other += 1;
      console.warn(
        `Face enrollment skipped for employee ${employee.id}: ${result.reason}`,
      );
    }
  }

  console.log(
    `Face template migration complete: ${employees.length} total active employees, ${employeeIdsWithPhotos.size} with photos, ${ready} newly enrolled, ${alreadyReady} already enrolled, ${skipped} failed or missing photos`,
  );
  console.log("Enrollment failure summary:", JSON.stringify(failures));
  if (skipped) process.exitCode = 1;
};

migrate()
  .catch((error) => {
    console.error("Face template migration failed:", error);
    process.exitCode = 1;
  })
  .finally(() => knex.destroy());
