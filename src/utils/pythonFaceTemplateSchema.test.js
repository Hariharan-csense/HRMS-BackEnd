const test = require("node:test");
const assert = require("node:assert/strict");
const knex = require("knex")({ client: "mysql2" });
const { REQUIRED_COLUMNS, requirePythonFaceSchema, activeTemplatesForEngine } = require("./pythonFaceTemplateSchema");

test("missing metadata produces a migration error, not a misleading enrollment error", async () => {
  const db = () => ({ columnInfo: async () => ({ employee_id: {}, template_hash: {} }) });
  db.schema = { hasTable: async () => true };
  await assert.rejects(requirePythonFaceSchema(db), (error) => {
    assert.equal(error.code, "FACE_TEMPLATE_SCHEMA_MISSING");
    assert.equal(error.statusCode, 503);
    assert.deepEqual(error.missingColumns, REQUIRED_COLUMNS);
    return true;
  });
});

test("missing table is diagnosed without querying it", async () => {
  const db = () => { throw Error("Missing table must not be queried"); };
  db.schema = { hasTable: async () => false };
  await assert.rejects(requirePythonFaceSchema(db), { code: "FACE_TEMPLATE_SCHEMA_MISSING" });
});

test("complete schema is accepted", async () => {
  const columns = Object.fromEntries(REQUIRED_COLUMNS.map((name) => [name, {}]));
  const db = () => ({ columnInfo: async () => columns });
  db.schema = { hasTable: async () => true };
  assert.equal(await requirePythonFaceSchema(db), columns);
});

test("legacy cache refresh cannot deactivate Python enrollment", () => {
  const query = activeTemplatesForEngine(knex, 12, "legacy").update({ is_active: false }).toSQL();
  assert.match(query.sql, /`model_name` is null or `model_name` = \?/);
  assert.deepEqual(query.bindings, [false, 12, true, "face-api.js"]);
});

test("Python enrollment replaces only that employee's Python rows", () => {
  const query = activeTemplatesForEngine(knex, 12, "python").update({ is_active: false }).toSQL();
  assert.match(query.sql, /`employee_id` = \? and `is_active` = \? and `model_name` = \?/);
  assert.deepEqual(query.bindings, [false, 12, true, "insightface"]);
});
