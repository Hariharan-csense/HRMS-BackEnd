const db = require("../db/db");

const COMPANY_ID = 51;
const TIME_ZONE = "Asia/Kolkata";
const CHECKOUT_HOUR = 23;
const CHECKOUT_MINUTE = 59;
const CHECK_INTERVAL_MS = 60 * 1000;

const getLocalDateParts = (date) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  return Object.fromEntries(parts.map(({ type, value }) => [type, value]));
};

const getCutoffInstant = (year, month, day) =>
  new Date(Date.UTC(year, month - 1, day, CHECKOUT_HOUR, CHECKOUT_MINUTE) - 330 * 60 * 1000);

async function closeMissedCheckouts(now = new Date()) {
  const openAttendance = await db("attendance")
    .select("id", "employee_id", "check_in")
    .where({ company_id: COMPANY_ID })
    .whereNull("check_out");

  let closedCount = 0;
  for (const record of openAttendance) {
    if (!record.check_in) continue;

    const checkIn = new Date(record.check_in);
    if (Number.isNaN(checkIn.getTime())) continue;
    const { year, month, day } = getLocalDateParts(checkIn);
    const cutoff = getCutoffInstant(Number(year), Number(month), Number(day));
    if (now < cutoff || checkIn >= cutoff) continue;

    const hoursWorked = Math.max(1 / 60, (cutoff - checkIn) / (60 * 60 * 1000));
    const updatedCount = await db("attendance")
      .where({ id: record.id, company_id: COMPANY_ID, employee_id: record.employee_id })
      .whereNull("check_out")
      .update({
        check_out: cutoff,
        hours_worked: hoursWorked,
        overtime_hours: Math.max(0, hoursWorked - 8),
        check_out_location: null,
        check_out_image_url: null,
        device_info: "Auto Checkout",
      });
    closedCount += updatedCount;
  }

  if (closedCount) {
    console.log(`Auto-checked out ${closedCount} open attendance record(s) for company ${COMPANY_ID}.`);
  }
  return closedCount;
}

function startCompany51AutoCheckout() {
  const tick = () => {
    closeMissedCheckouts().catch((error) => {
      console.error("Company 51 auto checkout failed:", error);
    });
  };

  tick();
  const timer = setInterval(tick, CHECK_INTERVAL_MS);
  timer.unref();
  return timer;
}

module.exports = { closeMissedCheckouts, startCompany51AutoCheckout };
