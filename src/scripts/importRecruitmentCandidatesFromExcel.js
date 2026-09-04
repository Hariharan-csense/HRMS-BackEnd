require("dotenv").config();

const path = require("path");
const knex = require("../db/db");
const XLSX = require("../../../FrontEnd/node_modules/xlsx");

const EXCEL_PATH = process.argv[2];
const COMPANY_ID = Number(process.argv[3] || 51);
const CREATED_BY = String(process.argv[4] || "42");

if (!EXCEL_PATH) {
  console.error(
    'Usage: node scripts/importRecruitmentCandidatesFromExcel.js "<excel-path>" [companyId] [createdBy]',
  );
  process.exit(1);
}

const normalizeHeader = (value) =>
  String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();

const toISODate = (value) => {
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
    }
  }

  const str = String(value || "").trim();
  if (!str) return new Date().toISOString().split("T")[0];

  const parsed = new Date(str);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().split("T")[0];
  }

  return new Date().toISOString().split("T")[0];
};

const cleanPhone = (value) =>
  String(value || "")
    .replace(/\D/g, "")
    .slice(0, 10);

const slugify = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/(^\.|\.$)/g, "")
    .slice(0, 40);

const ensurePhone = (phone, rowNumber) => {
  if (phone && /^[6-9]\d{9}$/.test(phone)) return phone;
  return `9${String(100000000 + rowNumber).slice(-9)}`;
};

const ensureEmail = (email, name, rowNumber) => {
  const normalized = String(email || "")
    .trim()
    .toLowerCase();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return normalized;

  const base = slugify(name) || `candidate.${rowNumber}`;
  return `${base}.${rowNumber}@imported.local`;
};

const buildNotes = (
  remarks,
  interviewAvailability,
  missingEmail,
  missingPhone,
) => {
  const parts = [];
  if (remarks) parts.push(`Remarks: ${remarks}`);
  if (interviewAvailability)
    parts.push(`Interview availability: ${interviewAvailability}`);
  if (missingEmail) parts.push("Original sheet had no email");
  if (missingPhone) parts.push("Original sheet had no phone");
  return parts.join(" | ");
};

async function main() {
  const resolvedPath = path.resolve(EXCEL_PATH);
  const workbook = XLSX.readFile(resolvedPath);
  const worksheet = workbook.Sheets[workbook.SheetNames[0]];
  const rawRows = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

  let inserted = 0;
  let skipped = 0;

  for (const [index, rawRow] of rawRows.entries()) {
    const rowNumber = index + 2;
    const row = {};

    for (const [key, value] of Object.entries(rawRow)) {
      row[normalizeHeader(key)] = value;
    }

    const name = String(row["candidate name"] || "").trim();
    const clientName = String(row["client name"] || "").trim();
    const position = String(row["position"] || "").trim();

    if (!name || !clientName || !position) {
      skipped += 1;
      continue;
    }

    const originalEmail = String(row["e mail address"] || "").trim();
    const originalPhone = cleanPhone(row["mobile no"]);
    const email = ensureEmail(originalEmail, name, rowNumber);
    const phone = ensurePhone(originalPhone, rowNumber);

    const existingCandidate = await knex("recruitment_candidates")
      .where({
        company_id: COMPANY_ID,
        name,
        position,
        client_name: clientName,
      })
      .andWhere(function whereExisting() {
        this.where("email", email).orWhere("phone", phone);
      })
      .first();

    if (existingCandidate) {
      skipped += 1;
      continue;
    }

    await knex("recruitment_candidates").insert({
      company_id: COMPANY_ID,
      name,
      client_name: clientName,
      email,
      phone,
      position,
      job_location: String(row["job location"] || "").trim(),
      age: row["age"] ? Number(row["age"]) || null : null,
      gender: String(row["gender"] || "").trim(),
      native_place: String(row["native"] || "").trim(),
      highest_qualification: String(row["highest qualification"] || "").trim(),
      department: clientName,
      experience: String(row["total exp"] || "").trim(),
      relevant_experience: String(row["relevant exp"] || "").trim(),
      current_company: String(row["current employer"] || "").trim(),
      current_designation: String(row["current designation"] || "").trim(),
      current_location: String(row["curent location"] || "").trim(),
      ctc: String(row["ctc"] || "").trim(),
      ectc: String(row["ectc"] || "").trim(),
      expected_salary: String(row["ectc"] || "").trim(),
      notice_period: String(row["notice period"] || "").trim(),
      skills: null,
      resume_url: null,
      source: path.basename(resolvedPath),
      notes: buildNotes(
        String(row["remarks notes"] || "").trim(),
        String(row["interview avl"] || "").trim(),
        !originalEmail,
        !originalPhone,
      ),
      applied_date: toISODate(row["date of creation"]),
      status: "applied",
      created_by: CREATED_BY,
    });

    inserted += 1;
  }

  console.log(
    JSON.stringify(
      {
        file: resolvedPath,
        rows: rawRows.length,
        inserted,
        skipped,
        companyId: COMPANY_ID,
        createdBy: CREATED_BY,
      },
      null,
      2,
    ),
  );
}

main()
  .catch(async (error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await knex.destroy();
  });
