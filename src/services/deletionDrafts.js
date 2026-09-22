const crypto = require("node:crypto");
const db = require("../db/db");
const {
  fail,
  encrypt,
  decrypt,
  readSchema,
  collectArchive,
  fingerprint,
  restoreArchive,
} = require("./deletionArchive");

const entities = {
  employee: { table: "employees" },
  user: { table: "users" },
  branch: { table: "branches" },
  department: { table: "departments" },
  designation: { table: "designations" },
  asset: { table: "assets" },
  client: { table: "clients" },
  role: { table: "roles" },
  role_assignment: { table: "role_assignments", patch: { status: "Inactive" } },
  salary_structure: { table: "payroll_structures" },
  payroll: { table: "payroll_processing" },
  holiday: { table: "holidays" },
  fiscal_year: { table: "fiscal_year" },
  leave_type: { table: "leave_types" },
  leave_policy: { table: "leave_policies", patch: { status: "inactive" } },
  expense: { table: "expenses", param: "expense_id", key: "expense_id" },
  job_requirement: { table: "job_requirements" },
  candidate: { table: "recruitment_candidates" },
  offer_letter: { table: "offer_letters" },
  offer_template: { table: "offer_templates" },
  onboarding: { table: "onboarding_employees" },
  auto_number: { table: "auto_number_settings" },
  shift: { table: "shifts" },
  shift_roster: { table: "shift_roster_assignments" },
  ticket: { table: "tickets" },
  survey: { table: "surveys" },
  feedback: { table: "employee_feedback", companyColumn: "companyId" },
  survey_template: { table: "pulse_survey_templates" },
  company: { table: "companies", company: true },
  subscription_plan: { table: "subscription_plans", global: true },
  subscription_addon: { table: "subscription_addons", global: true },
  company_addon: {
    table: "company_subscription_addons",
    param: "assignmentId",
    platform: true,
  },
  kpi_attachment: {
    table: "kpi_parameters",
    param: "parameterId",
    viaTemplate: true,
    patch: {
      attachment_path: null,
      attachment_name: null,
      attachment_uploaded_by_name: null,
      attachment_uploaded_at: null,
    },
  },
};

const actorId = (user) => `${user.type}:${user.id}`;
async function capabilities(user, conn = db) {
  const table = user?.type === "admin" ? "users" : "employees";
  const account = user?.id
    ? await conn(table).where({ id: user.id }).first()
    : null;
  if (!account) fail(401, "Account no longer exists");
  if (String(account.company_id || "") !== String(user.company_id || ""))
    fail(403, "Company access has changed. Sign in again.");
  const roles = new Set([
    String(account.role || "")
      .toLowerCase()
      .trim(),
  ]);
  if (table === "employees" && account.company_id) {
    const assignments = await conn("role_assignments as a")
      .join("roles as r", "a.role_id", "r.id")
      .where({
        "a.employee_id": account.id,
        "a.company_id": account.company_id,
        "r.company_id": account.company_id,
        "a.status": "Active",
      })
      .select("r.name");
    for (const role of assignments)
      roles.add(String(role.name).toLowerCase().trim());
  }
  return {
    ceo: roles.has("ceo"),
    admin: roles.has("admin") || roles.has("superadmin"),
    superadmin: roles.has("superadmin"),
    roles,
  };
}

async function target(conn, entity, id, companyId, caps) {
  const config = entities[entity];
  if (!config) fail(400, "Unsupported deletion type");
  const where = { [config.key || "id"]: id };
  if (!config.global && !config.company && !config.viaTemplate)
    where[config.companyColumn || "company_id"] = companyId;
  if (config.company && String(id) !== String(companyId) && !caps.superadmin)
    fail(403, "Access denied");
  const row = await conn(config.table).where(where).forUpdate().first();
  if (!row) fail(404, "Record not found or access denied");
  if (config.viaTemplate) {
    const template = await conn("kpi_templates")
      .where({ id: row.kpi_template_id, company_id: companyId })
      .first();
    if (!template) fail(404, "Record not found or access denied");
  }
  return {
    config,
    row,
    where: Object.fromEntries(Object.keys(where).map((key) => [key, row[key]])),
  };
}

async function validate(conn, entity, row, user, caps) {
  if (["role", "role_assignment"].includes(entity) && !caps.admin && !caps.ceo)
    fail(403, "Only Admin or CEO can request role removal");
  if (
    entity === "role" &&
    (await conn("role_assignments")
      .where({ role_id: row.id, company_id: row.company_id, status: "Active" })
      .first())
  ) {
    fail(409, "Remove active role assignments before deleting this role");
  }
  if (
    entity === "leave_type" &&
    (await conn("leave_applications")
      .where({ company_id: row.company_id, leave_type_id: row.id })
      .first())
  ) {
    fail(
      409,
      "This leave type is used by leave applications and cannot be deleted",
    );
  }
  if (
    entity === "offer_template" &&
    (await conn("offer_letters")
      .where({ company_id: row.company_id, template: row.name })
      .first())
  ) {
    fail(409, "This template is used by offer letters and cannot be deleted");
  }
  if (
    entity === "expense" &&
    !["admin", "finance", "ceo", "superadmin"].some((role) =>
      caps.roles.has(role),
    )
  ) {
    const employeeId =
      user.employee_id || (user.type === "employee" ? user.id : null);
    if (!employeeId || String(row.employee_id) !== String(employeeId))
      fail(403, "You may only request deletion of your own expenses");
    if (String(row.status).toLowerCase() !== "pending")
      fail(409, "Only pending expenses can be deleted");
  }
  if (
    entity === "ticket" &&
    user.type === "employee" &&
    !["admin", "ceo", "hr", "manager", "superadmin"].some((role) =>
      caps.roles.has(role),
    )
  ) {
    if (
      ![user.id, user.employee_id].some(
        (id) => id != null && String(id) === String(row.created_by),
      )
    )
      fail(403, "Access denied");
  }
}

async function makeArchive(conn, entity, targetRow, schema, companyId) {
  const { config, row, where } = targetRow;
  let patch = config.patch;
  if (
    entity === "subscription_plan" &&
    (await conn("company_subscriptions")
      .where({ plan_id: row.id })
      .whereIn("status", ["active", "trial"])
      .first())
  )
    patch = { is_active: 0 };
  if (
    entity === "subscription_addon" &&
    (await conn("company_subscription_addons")
      .where({ addon_id: row.id })
      .first())
  )
    patch = { is_active: 0 };
  if (patch) {
    return {
      records: [],
      roots: [],
      updates: [
        {
          table: config.table,
          key: where,
          before: Object.fromEntries(
            Object.keys(patch).map((key) => [key, row[key]]),
          ),
          after: patch,
        },
      ],
    };
  }
  const roots = [];
  const add = (table, condition) => {
    if (schema.tables[table]) roots.push({ table, where: condition });
  };
  if (entity === "employee") {
    // These records are employee-owned even on installations without FKs.
    // Onboarding tables use a different employee namespace and are not included.
    for (const table of [
      "employee_documents",
      "employee_bank_details",
      "attendance",
      "attendance_overrides",
      "client_assignments",
      "client_attendance",
      "expenses",
      "expense_drafts",
      "face_templates",
      "leave_applications",
      "leave_balances",
      "leave_permissions",
      "payroll_processing",
      "payroll_structures",
      "payroll_structure_history",
      "resignations",
      "settlements",
      "shift_roster_assignments",
      "role_assignments",
    ]) {
      if (!schema.tables[table]) continue;
      const condition = { employee_id: row.id };
      if (schema.tables[table].some((c) => c.COLUMN_NAME === "company_id"))
        condition.company_id = companyId;
      add(table, condition);
    }
  }
  if (entity === "user") add("user_roles", { user_id: row.id });
  if (entity === "salary_structure")
    add("payroll_structure_history", {
      employee_id: row.employee_id,
      company_id: companyId,
    });
  if (config.company) {
    // Company deletion is only possible if every dependent row can be archived
    // and the existing FK restrictions allow it. Archive records are excluded.
    for (const [table, columns] of Object.entries(schema.tables)) {
      if (
        ["companies", "deletion_drafts"].includes(table) ||
        table.startsWith("knex_")
      )
        continue;
      const column = columns.find((c) =>
        ["company_id", "companyId"].includes(c.COLUMN_NAME),
      );
      if (column) add(table, { [column.COLUMN_NAME]: row.id });
    }
  }
  add(config.table, where);
  return collectArchive(conn, roots, schema, companyId);
}

const summaryFor = (archive) => {
  const counts = {};
  for (const item of archive.records)
    counts[item.table] = (counts[item.table] || 0) + 1;
  return {
    deletedRecords: archive.records.length,
    updatedRecords: archive.updates.length,
    tables: counts,
  };
};

async function createDraft(user, entity, id, reason, conn = db) {
  return conn.transaction(async (trx) => {
    const caps = await capabilities(user, trx);
    const config = entities[entity];
    if (!config) fail(400, "Unsupported deletion type");
    if ((config.global || config.platform) && !caps.superadmin)
      fail(403, "Superadmin access required");
    if (!config.global && !user.company_id && !caps.superadmin)
      fail(403, "Company context required");
    let companyId = config.global ? null : user.company_id;
    if (config.company) companyId = id;
    if (config.platform && caps.superadmin) {
      const assigned = await trx(config.table).where({ id }).first();
      if (!assigned) fail(404, "Record not found");
      companyId = assigned.company_id;
    }
    const item = await target(trx, entity, id, companyId, caps);
    // Never allow a caller to choose a different tenant by changing the ID.
    if (
      config.company &&
      !caps.superadmin &&
      String(id) !== String(user.company_id)
    )
      fail(403, "Access denied");
    await validate(trx, entity, item.row, user, caps);
    const pendingKey = crypto
      .createHash("sha256")
      .update(
        `${companyId}:${config.table}:${id}:${entity === "kpi_attachment" ? "attachment" : "record"}`,
      )
      .digest("hex");
    const existing = await trx("deletion_drafts")
      .where({ pending_key: pendingKey })
      .first();
    if (existing) return { id: existing.id, duplicate: true };
    const schema = await readSchema(trx);
    const archive = await makeArchive(trx, entity, item, schema, companyId);
    const label =
      item.row.name ||
      item.row.company_name ||
      [item.row.first_name, item.row.last_name].filter(Boolean).join(" ") ||
      item.row.employee_id ||
      item.row.title ||
      `${entity} #${id}`;
    const [draftId] = await trx("deletion_drafts").insert({
      company_id: companyId,
      entity,
      record_id: String(id),
      record_code: entity === "employee" ? item.row.employee_id || null : null,
      record_label: String(label).slice(0, 255),
      status: "pending",
      pending_key: pendingKey,
      archive: encrypt(archive),
      summary: JSON.stringify(summaryFor(archive)),
      requested_by: actorId(user),
      requested_by_name: user.name || user.email || actorId(user),
      reason: String(reason || "").slice(0, 2000) || null,
    });
    return { id: draftId, duplicate: false };
  });
}

async function actOnDraft(user, id, action, note, conn = db) {
  if (!["approve", "reject", "cancel", "restore"].includes(action))
    fail(400, "Invalid action");
  return conn.transaction(async (trx) => {
    const caps = await capabilities(user, trx);
    if (["approve", "reject"].includes(action) && !caps.ceo)
      fail(403, "Only CEO can approve or reject deletion");
    if (["cancel", "restore"].includes(action) && !caps.admin)
      fail(403, "Only Admin can cancel or restore deletion");
    const query = trx("deletion_drafts").where({ id });
    if (!caps.superadmin) query.where({ company_id: user.company_id || null });
    const draft = await query.forUpdate().first();
    if (!draft) fail(404, "Deletion request not found");
    if (action === "restore") {
      if (draft.status !== "deleted")
        fail(409, "Only an approved deletion can be restored");
      await restoreArchive(trx, decrypt(draft.archive), await readSchema(trx));
      await trx("deletion_drafts")
        .where({ id })
        .update({
          status: "restored",
          restored_by: actorId(user),
          restored_by_name: user.name || user.email,
          restored_at: trx.fn.now(),
          updated_at: trx.fn.now(),
        });
      return {
        status: "restored",
        message: "Record and archived linked data restored",
      };
    }
    if (draft.status !== "pending")
      fail(409, "This deletion request has already been reviewed");
    if (action === "approve") {
      const item = await target(
        trx,
        draft.entity,
        draft.record_id,
        draft.company_id,
        caps,
      );
      await validate(trx, draft.entity, item.row, user, caps);
      const latest = await makeArchive(
        trx,
        draft.entity,
        item,
        await readSchema(trx),
        draft.company_id,
      );
      if (fingerprint(latest) !== fingerprint(decrypt(draft.archive))) {
        fail(
          409,
          "The record or linked data changed after this request. Cancel it and submit a new request.",
        );
      }
      // Delete children before parents, preserving FK checks throughout.
      let remaining = [...latest.roots];
      while (remaining.length) {
        const retry = [];
        for (const root of remaining) {
          try {
            await trx(root.table).where(root.where).del();
          } catch (error) {
            if (error.code === "ER_ROW_IS_REFERENCED_2") retry.push(root);
            else throw error;
          }
        }
        if (retry.length === remaining.length)
          fail(
            409,
            "Other records still depend on this record. Nothing was deleted.",
          );
        remaining = retry;
      }
      for (const update of latest.updates)
        await trx(update.table).where(update.key).update(update.after);
    }
    const status = {
      approve: "deleted",
      reject: "rejected",
      cancel: "cancelled",
    }[action];
    await trx("deletion_drafts")
      .where({ id })
      .update({
        status,
        pending_key: null,
        reviewed_by: actorId(user),
        reviewed_by_name: user.name || user.email,
        reviewed_at: trx.fn.now(),
        review_note: String(note || "").slice(0, 2000) || null,
        updated_at: trx.fn.now(),
      });
    return {
      status,
      message:
        action === "approve"
          ? "CEO approved deletion. The record is archived and can be restored by Admin."
          : "Deletion request closed. The original record is retained.",
    };
  });
}

module.exports = {
  entities,
  capabilities,
  createDraft,
  actOnDraft,
  summaryFor,
};
