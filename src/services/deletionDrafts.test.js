const test = require("node:test");
const assert = require("node:assert/strict");
const { createDraft, actOnDraft, capabilities } = require("./deletionDrafts");
const { encrypt, decrypt, fingerprint } = require("./deletionArchive");

process.env.DELETION_ARCHIVE_KEY = "deletion-test-key-not-for-production";

// Transactional Knex double. No connection to the configured production database.
function fixture() {
  let data = {
    users: [
      { id: 1, company_id: 1, role: "admin" }, { id: 2, company_id: 1, role: "ceo" },
      { id: 3, company_id: 1, role: "employee" }, { id: 4, company_id: 2, role: "ceo" },
    ],
    employees: [{ id: 10, company_id: 1, first_name: "Test", last_name: "Employee", role: "employee" }],
    branches: [{ id: 7, company_id: 1, name: "Test branch" }, { id: 8, company_id: 2, name: "Other branch" }],
    employee_documents: [{ id: 20, employee_id: 10, file_path: "retained-test-file.pdf" }],
    employee_bank_details: [{ id: 21, employee_id: 10, account_number: "test-only" }],
    payroll_structures: [{ id: 30, company_id: 1, employee_id: 10, gross: "40000.00" }],
    payroll_structure_history: [{ id: 31, company_id: 1, employee_id: 10, structure_data: '{"gross":40000}' }],
    client_assignments: [{ id: 40, company_id: 1, employee_id: 10 }],
    employee_feedback: [{ id: 50, companyId: 1, employeeId: 10, message: "retained" }],
    role_assignments: [], roles: [], deletion_drafts: [],
    leave_policies: [{ id: 60, company_id: 1, status: "active", name: "Policy" }],
  };
  const links = [
    { TABLE_NAME: "client_assignments", COLUMN_NAME: "employee_id", REFERENCED_TABLE_NAME: "employees", REFERENCED_COLUMN_NAME: "id", CONSTRAINT_NAME: "assignment_employee", DELETE_RULE: "CASCADE" },
    { TABLE_NAME: "employee_feedback", COLUMN_NAME: "employeeId", REFERENCED_TABLE_NAME: "employees", REFERENCED_COLUMN_NAME: "id", CONSTRAINT_NAME: "feedback_employee", DELETE_RULE: "SET NULL" },
  ];
  const schema = Object.entries(data).flatMap(([table, rows]) => Object.keys(rows[0] || { id: 0, company_id: 0 }).map((column) => ({
    TABLE_NAME: table, COLUMN_NAME: column, COLUMN_KEY: column === "id" ? "PRI" : "", DATA_TYPE: "varchar", EXTRA: "",
  })));
  let sequence = 100;
  function db(tableName) {
    const table = tableName.split(" as ")[0];
    const filters = [];
    let first = false;
    const clean = (key) => key.split(".").at(-1);
    const selected = () => data[table].filter((row) => filters.every((fn) => fn(row)));
    const builder = {
      where(key, value) {
        const pairs = typeof key === "object" ? Object.entries(key) : [[key, value]];
        for (const [column, expected] of pairs) filters.push((row) => expected == null ? row[clean(column)] == null : String(row[clean(column)]) === String(expected));
        return builder;
      },
      whereIn(column, values) { filters.push((row) => values.includes(row[column])); return builder; },
      forUpdate() { return builder; }, join() { return builder; }, select() { return builder; },
      first() { first = true; return builder; },
      then(resolve, reject) { return Promise.resolve(structuredClone(first ? selected()[0] : selected())).then(resolve, reject); },
      async insert(row) {
        if (data[table].some((existing) => row.id != null && existing.id === row.id)) {
          const error = new Error("Duplicate"); error.code = "ER_DUP_ENTRY"; throw error;
        }
        const saved = structuredClone({ ...row, id: row.id ?? ++sequence }); data[table].push(saved); return [saved.id];
      },
      async update(values) { const rows = selected(); for (const row of rows) Object.assign(row, structuredClone(values)); return rows.length; },
      async del() {
        const rows = selected();
        for (const row of rows) {
          for (const link of links.filter((l) => l.REFERENCED_TABLE_NAME === table)) {
            const child = db(link.TABLE_NAME).where(link.COLUMN_NAME, row[link.REFERENCED_COLUMN_NAME]);
            if (link.DELETE_RULE === "CASCADE") await child.del();
            if (link.DELETE_RULE === "SET NULL") await child.update({ [link.COLUMN_NAME]: null });
          }
        }
        data[table] = data[table].filter((row) => !rows.includes(row)); return rows.length;
      },
    };
    return builder;
  }
  db.raw = async (sql) => [sql.includes("KEY_COLUMN_USAGE") ? links : schema];
  db.fn = { now: () => new Date("2026-09-22T10:00:00Z") };
  db.transaction = async (fn) => {
    const before = structuredClone(data);
    try { return await fn(db); } catch (error) { data = before; throw error; }
  };
  const user = (id) => ({ id, type: "admin", company_id: id === 4 ? 2 : 1, name: `User ${id}` });
  return { db, rows: (table) => data[table], admin: user(1), ceo: user(2), employee: user(3), otherCeo: user(4) };
}

test("draft keeps employee active; CEO deletes; Admin restores employee and linked records", async () => {
  const f = fixture();
  const draft = await createDraft(f.admin, "employee", 10, "Duplicate employee", f.db);
  assert.equal(f.rows("employees").length, 1);
  assert.equal(f.rows("employee_documents")[0].file_path, "retained-test-file.pdf");
  assert.equal((await createDraft(f.admin, "employee", 10, "", f.db)).id, draft.id);
  assert.equal(f.rows("deletion_drafts").length, 1);
  assert.ok(!f.rows("deletion_drafts")[0].archive.includes("account_number"));
  await assert.rejects(actOnDraft(f.admin, draft.id, "approve", "", f.db), { status: 403 });
  await actOnDraft(f.ceo, draft.id, "approve", "Approved", f.db);
  for (const table of ["employees", "employee_documents", "employee_bank_details", "payroll_structures", "payroll_structure_history", "client_assignments"]) assert.equal(f.rows(table).length, 0, table);
  assert.equal(f.rows("employee_feedback")[0].employeeId, null);
  await assert.rejects(actOnDraft(f.ceo, draft.id, "restore", "", f.db), { status: 403 });
  await actOnDraft(f.admin, draft.id, "restore", "", f.db);
  assert.equal(f.rows("employees")[0].id, 10);
  assert.equal(f.rows("employee_documents")[0].file_path, "retained-test-file.pdf");
  assert.equal(f.rows("payroll_structure_history")[0].structure_data, '{"gross":40000}');
  assert.equal(f.rows("employee_feedback")[0].employeeId, 10);
  assert.equal(f.rows("deletion_drafts")[0].status, "restored");
  await assert.rejects(actOnDraft(f.admin, draft.id, "restore", "", f.db), { status: 409 });
});

test("company isolation and persisted roles prevent approval escalation", async () => {
  const f = fixture();
  await assert.rejects(createDraft(f.admin, "branch", 8, "", f.db), { status: 404 });
  const draft = await createDraft(f.admin, "branch", 7, "", f.db);
  await assert.rejects(actOnDraft(f.otherCeo, draft.id, "approve", "", f.db), { status: 404 });
  await assert.rejects(actOnDraft({ ...f.employee, role: "ceo", roles: ["ceo"] }, draft.id, "approve", "", f.db), { status: 403 });
  assert.equal((await capabilities({ ...f.employee, roles: ["admin"] }, f.db)).admin, false);
});

test("reject and cancel retain data and allow a new request", async () => {
  const f = fixture();
  const first = await createDraft(f.admin, "branch", 7, "", f.db);
  await actOnDraft(f.ceo, first.id, "reject", "Still needed", f.db);
  assert.equal(f.rows("branches").length, 2);
  const next = await createDraft(f.admin, "branch", 7, "", f.db);
  assert.notEqual(next.id, first.id);
  await actOnDraft(f.admin, next.id, "cancel", "", f.db);
  assert.equal(f.rows("branches").length, 2);
});

test("changes since request block approval without deleting any data", async () => {
  const f = fixture();
  const draft = await createDraft(f.admin, "employee", 10, "", f.db);
  await f.db("employee_documents").where({ id: 20 }).update({ file_path: "new-file.pdf" });
  await assert.rejects(actOnDraft(f.ceo, draft.id, "approve", "", f.db), { status: 409 });
  assert.equal(f.rows("employees").length, 1);
  assert.equal(f.rows("deletion_drafts")[0].status, "pending");
});

test("restore conflicts roll back the whole restore and retain the archive", async () => {
  const f = fixture();
  const draft = await createDraft(f.admin, "employee", 10, "", f.db);
  await actOnDraft(f.ceo, draft.id, "approve", "", f.db);
  await f.db("employee_feedback").where({ id: 50 }).update({ employeeId: 999 });
  await assert.rejects(actOnDraft(f.admin, draft.id, "restore", "", f.db), { status: 409 });
  assert.equal(f.rows("employees").length, 0);
  assert.equal(f.rows("employee_documents").length, 0);
  assert.equal(f.rows("deletion_drafts")[0].status, "deleted");
});

test("soft removal restores only changed fields", async () => {
  const f = fixture();
  const draft = await createDraft(f.admin, "leave_policy", 60, "", f.db);
  await actOnDraft(f.ceo, draft.id, "approve", "", f.db);
  assert.equal(f.rows("leave_policies")[0].status, "inactive");
  await f.db("leave_policies").where({ id: 60 }).update({ name: "Edited description" });
  await actOnDraft(f.admin, draft.id, "restore", "", f.db);
  assert.equal(f.rows("leave_policies")[0].status, "active");
  assert.equal(f.rows("leave_policies")[0].name, "Edited description");
});

test("archive encryption round-trips dates, binary values and JSON", () => {
  const original = { date: new Date("2026-09-22T10:11:12Z"), binary: Buffer.from([0, 1, 255]), data: { values: [1, 2] } };
  assert.deepEqual(decrypt(encrypt(original)), original);
  const archive = { records: [{ row: { values: [1, 2] } }], roots: [], updates: [] };
  assert.notEqual(fingerprint(archive), fingerprint({ ...archive, records: [{ row: { values: [2, 1] } }] }));
});
