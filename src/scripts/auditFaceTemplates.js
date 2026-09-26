const fs = require("fs");
const path = require("path");
const db = require("../db/db");

const expectedDimension = Math.max(1, Number(process.env.FACE_EMBEDDING_DIMENSION) || 512);
const expectedModel = process.env.FACE_MODEL_VERSION || `insightface-${process.env.FACE_MODEL_NAME || "buffalo_s"}`;
const shouldDeactivate = process.argv.includes("--deactivate-invalid");
const reportPathArg = process.argv.find((value) => value.startsWith("--report="));
const reportPath = path.resolve(reportPathArg ? reportPathArg.slice(9) : "face-template-audit.json");

const inspect = (row) => {
  const issues = [];
  if (row.model_name === "insightface") {
    let payload;
    try { payload = JSON.parse(row.template_hash); } catch { issues.push("MALFORMED_JSON"); return issues; }
    const embedding = payload?.embedding;
    if (!Array.isArray(embedding)) issues.push("MISSING_EMBEDDING");
    else {
      if (embedding.length !== expectedDimension) issues.push("INVALID_DIMENSION");
      if (embedding.some((value) => !Number.isFinite(Number(value)))) issues.push("NON_FINITE_EMBEDDING");
      if (!embedding.some((value) => Number(value) !== 0)) issues.push("ZERO_VECTOR");
    }
    if (row.model_version !== expectedModel) issues.push("STALE_MODEL_VERSION");
  }
  if (!row.employee_exists) issues.push("DELETED_EMPLOYEE");
  else {
    if (Number(row.company_id) !== Number(row.employee_company_id)) issues.push("COMPANY_MISMATCH");
    if (String(row.employee_status || "active").trim().toLowerCase() !== "active") issues.push("INACTIVE_EMPLOYEE");
  }
  return issues;
};

(async () => {
  const rows = await db("face_templates as ft")
    .leftJoin("employees as e", "e.id", "ft.employee_id")
    .where("ft.is_active", true)
    .select("ft.id", "ft.employee_id", "ft.company_id", "ft.model_name", "ft.model_version",
      "ft.template_hash", db.raw("e.id IS NOT NULL AS employee_exists"),
      "e.company_id as employee_company_id", "e.status as employee_status");
  const seen = new Map();
  const report = rows.map((row) => {
    const issues = inspect(row);
    if (row.model_name === "insightface") {
      const key = `${row.company_id}:${row.employee_id}:${row.model_version}`;
      if (seen.has(key)) issues.push("DUPLICATE_ACTIVE_TEMPLATE");
      else seen.set(key, row.id);
    }
    return { id: row.id, employee_id: row.employee_id, company_id: row.company_id,
      model_version: row.model_version, issues };
  });
  const problematic = report.filter((row) => row.issues.length);
  fs.writeFileSync(reportPath, JSON.stringify({
    generated_at: new Date().toISOString(), expected_model: expectedModel,
    expected_dimension: expectedDimension, active_templates: rows.length,
    problematic_templates: problematic.length, rows: report,
  }, null, 2));
  console.log(`Face template audit: ${rows.length} active, ${problematic.length} problematic. Report: ${reportPath}`);
  if (shouldDeactivate && problematic.length) {
    const ids = problematic.map((row) => row.id);
    await db("face_templates").whereIn("id", ids).update({ is_active: false, updated_at: db.fn.now() });
    console.log(`Deactivated ${ids.length} invalid/stale templates. The report contains IDs for review and re-enrollment.`);
  } else if (problematic.length) {
    console.log("No rows changed. Review the report, back up the database, then rerun with --deactivate-invalid.");
    process.exitCode = 2;
  }
})().catch((error) => {
  console.error("Face template audit failed:", error.code || error.message);
  process.exitCode = 1;
}).finally(() => db.destroy());
