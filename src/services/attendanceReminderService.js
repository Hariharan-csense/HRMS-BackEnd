const db = require("../db/db");
const { sendPushToUsers } = require("./pushNotificationService");

const CHECK_INTERVAL_MS = 30 * 1000;
const REMINDER_MINUTES = 5;

const normalizeTimeZone = (value) => {
  const candidate = String(value || "Asia/Kolkata").trim();
  const timezone = candidate.toUpperCase() === "IST" ? "Asia/Kolkata" : candidate;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return timezone;
  } catch {
    return "Asia/Kolkata";
  }
};

const getLocalParts = (date, timeZone) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.map(({ type, value }) => [type, value]));
};

const timeToMinutes = (value) => {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
};

const ensureReminderTable = async () => {
  if (await db.schema.hasTable("attendance_reminder_deliveries")) return;
  await db.schema.createTable("attendance_reminder_deliveries", (table) => {
    table.increments("id").primary();
    table.integer("company_id").unsigned().notNullable();
    table.integer("employee_id").unsigned().notNullable();
    table.integer("shift_id").unsigned().notNullable();
    table.date("local_date").notNullable();
    table.enum("reminder_type", ["check_in", "check_out"]).notNullable();
    table.timestamp("sent_at").notNullable().defaultTo(db.fn.now());
    table.unique(
      ["company_id", "employee_id", "shift_id", "local_date", "reminder_type"],
      "attendance_reminder_delivery_unique",
    );
  });
};

const ensureRosterTable = async () => {
  if (await db.schema.hasTable("shift_roster_assignments")) return;
  await db.schema.createTable("shift_roster_assignments", (table) => {
    table.increments("id").primary();
    table.integer("company_id").unsigned().notNullable();
    table.integer("employee_id").unsigned().notNullable();
    table.integer("shift_id").unsigned().nullable();
    table.date("roster_date").notNullable();
    table.string("status", 30).notNullable().defaultTo("scheduled");
    table.string("notes", 500).nullable();
    table.integer("created_by").unsigned().nullable();
    table.integer("updated_by").unsigned().nullable();
    table.timestamps(true, true);
    table.unique(["company_id", "employee_id", "roster_date"], "shift_roster_assignments_unique");
  });
};

const getDailyAssignments = async (companyId, localDate) => {
  const employees = await db("employees as e")
    .leftJoin("shift_roster_assignments as r", function () {
      this.on("r.employee_id", "=", "e.id")
        .andOn("r.company_id", "=", "e.company_id")
        .andOn(db.raw("r.roster_date = ?", [localDate]));
    })
    .leftJoin("shifts as roster_shift", "r.shift_id", "roster_shift.id")
    .leftJoin("shifts as employee_shift", "e.shift_id", "employee_shift.id")
    .where("e.company_id", companyId)
    .where("e.status", "Active")
    .where(function () {
      this.whereNull("r.id").orWhere("r.status", "scheduled");
    })
    .select(
      "e.id as employee_id",
      db.raw("CASE WHEN r.id IS NOT NULL THEN roster_shift.id ELSE employee_shift.id END as shift_id"),
      db.raw("CASE WHEN r.id IS NOT NULL THEN roster_shift.name ELSE employee_shift.name END as shift_name"),
      db.raw("CASE WHEN r.id IS NOT NULL THEN roster_shift.start_time ELSE employee_shift.start_time END as start_time"),
      db.raw("CASE WHEN r.id IS NOT NULL THEN roster_shift.end_time ELSE employee_shift.end_time END as end_time"),
    );
  return employees.filter((row) => row.shift_id && row.start_time && row.end_time);
};

const deliverReminder = async ({ companyId, employeeId, shiftId, shiftName, type, localDate, timeZone }) => {
  // The unique delivery key also prevents duplicate reminders across multiple server instances.
  try {
    await db("attendance_reminder_deliveries").insert({
      company_id: companyId,
      employee_id: employeeId,
      shift_id: shiftId,
      local_date: localDate,
      reminder_type: type,
    });
  } catch (error) {
    if (error?.code === "ER_DUP_ENTRY" || error?.code === "SQLITE_CONSTRAINT" || error?.code === "23505") return;
    throw error;
  }

  const isCheckIn = type === "check_in";
  const timeLabel = isCheckIn ? "shift start" : "shift end";
  try {
    const result = await sendPushToUsers({
      userIds: [employeeId],
      companyId,
      title: isCheckIn ? "Check-in reminder" : "Check-out reminder",
      body: `${shiftName || "Your shift"} ${timeLabel} is in ${REMINDER_MINUTES} minutes. Please check ${isCheckIn ? "in" : "out"}.`,
      data: {
        type: `attendance_${type}_reminder`,
        actionUrl: "/attendance/capture",
        shiftId,
        localDate,
        timeZone,
      },
    });

    if (!result.sent) {
      await db("attendance_reminder_deliveries")
        .where({ company_id: companyId, employee_id: employeeId, shift_id: shiftId, local_date: localDate, reminder_type: type })
        .del();
    }
  } catch (error) {
    await db("attendance_reminder_deliveries")
      .where({ company_id: companyId, employee_id: employeeId, shift_id: shiftId, local_date: localDate, reminder_type: type })
      .del();
    throw error;
  }
};

let running = false;
const sendDueReminders = async (now = new Date()) => {
  if (running) return;
  running = true;
  try {
    await ensureReminderTable();
    await ensureRosterTable();
    const companies = await db("companies").select("id", "timezone");
    for (const company of companies) {
      const timeZone = normalizeTimeZone(company.timezone);
      const local = getLocalParts(now, timeZone);
      const localDate = `${local.year}-${local.month}-${local.day}`;
      const currentMinutes = Number(local.hour) * 60 + Number(local.minute);
      const assignments = await getDailyAssignments(company.id, localDate);

      for (const assignment of assignments) {
        const events = [
          { type: "check_in", dueAt: timeToMinutes(assignment.start_time) },
          { type: "check_out", dueAt: timeToMinutes(assignment.end_time) },
        ];
        for (const event of events) {
          if (event.dueAt === null || currentMinutes !== event.dueAt - REMINDER_MINUTES) continue;
          try {
            await deliverReminder({
              companyId: company.id,
              employeeId: assignment.employee_id,
              shiftId: assignment.shift_id,
              shiftName: assignment.shift_name,
              type: event.type,
              localDate,
              timeZone,
            });
          } catch (error) {
            console.error("Attendance reminder delivery failed:", error.message);
          }
        }
      }
    }
  } finally {
    running = false;
  }
};

const startAttendanceReminders = () => {
  const tick = () => sendDueReminders().catch((error) => {
    console.error("Attendance reminder scheduler failed:", error.message);
  });
  tick();
  const timer = setInterval(tick, CHECK_INTERVAL_MS);
  timer.unref();
  return timer;
};

module.exports = { sendDueReminders, startAttendanceReminders };
