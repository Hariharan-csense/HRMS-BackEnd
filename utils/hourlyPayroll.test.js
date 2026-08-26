const assert = require("node:assert/strict");
const { calculateHourlyPayroll, calculateShiftHours } = require("./hourlyPayroll");

const row = (day, hours, overtime = 0) => ({
  day,
  check_in: `${day} 09:00:00`,
  check_out: `${day} 18:00:00`,
  status: "present",
  hours_worked: hours,
  overtime_hours: overtime,
});

assert.equal(calculateShiftHours("09:00:00", "18:00:00"), 9);
assert.equal(calculateShiftHours("22:00:00", "06:00:00"), 8);

assert.deepEqual(
  calculateHourlyPayroll({
    attendanceRows: [row("2026-08-01", 5), row("2026-08-01", 5)],
    standardHoursPerDay: 8,
    hourlyRate: 100,
    overtimeHourlyRate: 150,
  }),
  {
    totalWorkedHours: 10,
    normalHours: 8,
    overtimeHours: 2,
    normalPay: 800,
    overtimePay: 300,
    grossEarnings: 1100,
  },
);

assert.deepEqual(
  calculateHourlyPayroll({
    attendanceRows: [row("2026-08-02", 10)],
    standardHoursPerDay: 8,
    hourlyRate: 100,
    overtimeHourlyRate: 0,
  }),
  {
    totalWorkedHours: 10,
    normalHours: 8,
    overtimeHours: 2,
    normalPay: 800,
    overtimePay: 200,
    grossEarnings: 1000,
  },
);

console.log("Hourly payroll calculation tests passed");
