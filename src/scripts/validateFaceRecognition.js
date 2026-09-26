const fs = require("fs");
const db = require("../db/db");
const { findEmployeeByFace } = require("../utils/faceRecognition");
const { resolveUploadPath } = require("../utils/uploadPaths");

const option = (name) => {
  const value = process.argv.find((item) => item.startsWith(`--${name}=`));
  return value ? value.slice(name.length + 3) : null;
};
const companyId = Number(option("company"));
if (!Number.isSafeInteger(companyId) || companyId <= 0) {
  console.error("Usage: npm run face:validate -- --company=<id> [--unknown=<image>] [--poor-quality=<image>] [--two-faces=<image>]");
  process.exit(1);
}
const rejectionCases = [
  ["unknown", new Set(["FACE_NOT_MATCHED", "AMBIGUOUS_MATCH"])],
  ["poor-quality", new Set(["NO_FACE", "LOW_IMAGE_QUALITY", "FACE_TOO_SMALL", "INVALID_IMAGE"])],
  ["two-faces", new Set(["MULTIPLE_FACES"])],
];

(async () => {
  const modelVersion = process.env.FACE_MODEL_VERSION || `insightface-${process.env.FACE_MODEL_NAME || "buffalo_s"}`;
  const rows = await db("face_templates as ft")
    .join("employees as e", function () {
      this.on("e.id", "ft.employee_id").andOn("e.company_id", "ft.company_id");
    })
    .where({ "ft.company_id": companyId, "ft.model_name": "insightface",
      "ft.model_version": modelVersion, "ft.is_active": true })
    .whereRaw("LOWER(TRIM(COALESCE(e.status, 'active'))) = 'active'")
    .whereNotNull("ft.source_photo")
    .select("e.id as employee_id", "ft.source_photo")
    .orderBy("e.id");
  const unique = [...new Map(rows.map((row) => [Number(row.employee_id), row])).values()];
  if (!unique.length) throw new Error("No active enrolled source photos are available for this company");
  let accepted = 0;
  let unavailable = 0;
  for (const row of unique) {
    const imagePath = resolveUploadPath(row.source_photo);
    if (!imagePath || !fs.existsSync(imagePath)) { unavailable++; continue; }
    const result = await findEmployeeByFace(companyId, imagePath);
    if (Number(result.employee.id) !== Number(row.employee_id)) {
      throw new Error(`Wrong identity: expected employee ${row.employee_id}, received ${result.employee.id}`);
    }
    accepted++;
    console.log(`PASS employee ${row.employee_id}: similarity=${result.similarity}, model=${result.modelVersion}`);
  }
  for (const [name, expected] of rejectionCases) {
    const supplied = option(name);
    if (!supplied) continue;
    const imagePath = resolveUploadPath(supplied);
    try {
      const result = await findEmployeeByFace(companyId, imagePath);
      throw new Error(`${name} image incorrectly matched employee ${result.employee.id}`);
    } catch (error) {
      if (!expected.has(error.code)) throw error;
      console.log(`PASS ${name}: rejected with ${error.code}`);
    }
  }
  console.log(`Recognition validation complete: ${accepted} correct identities, ${unavailable} source photos unavailable locally. No attendance rows were created.`);
  if (!accepted) process.exitCode = 2;
})().catch((error) => {
  console.error("Recognition validation failed:", error.code || error.message);
  process.exitCode = 1;
}).finally(() => db.destroy());

