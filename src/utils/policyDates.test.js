const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const test = require("node:test");

for (const timezone of ["Asia/Kolkata", "UTC", "America/Los_Angeles"]) {
  test(`policy month boundaries are calendar dates in ${timezone}`, () => {
    const result = execFileSync(process.execPath, ["-e", `
      const { monthStartEnd } = require('./policyDates');
      console.log(JSON.stringify([
        monthStartEnd('2026-09-01'),
        monthStartEnd('2026-09-30'),
        monthStartEnd('2024-02-29'),
        monthStartEnd('2026-02-01'),
        monthStartEnd('2026-12-31'),
      ]));
    `], { cwd: __dirname, env: { ...process.env, TZ: timezone }, encoding: "utf8" });
    assert.deepEqual(JSON.parse(result), [
      { start: "2026-09-01", end: "2026-09-30" },
      { start: "2026-09-01", end: "2026-09-30" },
      { start: "2024-02-01", end: "2024-02-29" },
      { start: "2026-02-01", end: "2026-02-28" },
      { start: "2026-12-01", end: "2026-12-31" },
    ]);
  });
}
