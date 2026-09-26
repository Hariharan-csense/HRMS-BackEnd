const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

// Exercise the actual validator with an isolated database fixture.
const loadValidator = (rows) => {
  const knex = (table) => {
    let selected = rows;
    const query = {
      where(filters) {
        selected = selected.filter(row => Object.entries(filters).every(([key, value]) => row[key] === value));
        return query;
      },
      whereIn(key, values) {
        selected = selected.filter(row => values.includes(row[key]));
        return query;
      },
      whereBetween(key, [start, end]) {
        selected = selected.filter(row => row[key] >= start && row[key] <= end);
        return query;
      },
      first: async () => undefined, // No saved policy: default 2 units, 1 hour each.
      select: async () => selected,
    };
    assert.ok(["company_policies", "leave_permissions"].includes(table));
    return query;
  };
  knex.schema = { hasTable: async () => true, hasColumn: async () => true };
  const sandbox = {
    module: { exports: {} },
    require: (name) => {
      if (name === "../db/db") return knex;
      if (name === "./leaveBalanceService") return {};
      if (name === "../utils/policyDates") return require("../utils/policyDates");
      throw new Error(`Unexpected import: ${name}`);
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "companyPolicyService.js"), "utf8"), sandbox);
  return sandbox.module.exports.validatePermissionPolicy;
};

const request = {
  companyId: 1, employeeId: 7, permissionDate: "2026-09-23",
  permissionTimeFrom: "09:00", permissionTimeTo: "11:00",
};
const permission = (date, status = "approved") => ({
  company_id: 1, employee_id: 7, permission_date: date, status,
  permission_time_from: "09:00", permission_time_to: "11:00",
});

test("August 31 usage does not consume September's two available units", async () => {
  const validate = loadValidator([permission("2026-08-31")]);
  assert.equal(await validate(request), null);
});

test("September 30 pending usage consumes September balance", async () => {
  const validate = loadValidator([permission("2026-09-30", "pending")]);
  assert.match(await validate(request), /2026-09: 2 used .*0 remaining; this request needs 2/);
});

test("rejected requests and other employees do not consume balance", async () => {
  const validate = loadValidator([
    permission("2026-09-20", "rejected"),
    { ...permission("2026-09-20"), employee_id: 8 },
    { ...permission("2026-09-20"), company_id: 2 },
  ]);
  assert.equal(await validate(request), null);
});

test("three-hour request explains why two unused units are insufficient", async () => {
  const validate = loadValidator([]);
  assert.match(await validate({ ...request, permissionTimeTo: "12:00" }), /0 used .*2 remaining; this request needs 3/);
});
