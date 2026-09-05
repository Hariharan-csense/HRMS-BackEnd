const assert = require("node:assert/strict");
const test = require("node:test");
const {
  addDaysToDateKey,
  formatTime,
  getDateKey,
  getMonthKey,
} = require("./dateTime");

test("formats stored UTC attendance timestamps in IST", () => {
  const timestamp = "2026-09-04T03:49:00.000Z";

  assert.equal(getDateKey(timestamp), "2026-09-04");
  assert.equal(getMonthKey(timestamp), "2026-09");
  assert.match(formatTime(timestamp), /^09:19\s*(am|AM)$/);
});

test("uses the IST calendar date across the UTC midnight boundary", () => {
  assert.equal(getDateKey("2026-09-04T20:00:00.000Z"), "2026-09-05");
  assert.equal(addDaysToDateKey("2026-09-05", -1), "2026-09-04");
});
