const roundTo2 = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

const normalizeStatus = (value) => {
  const status = String(value || "").trim().toLowerCase();
  return status === "half-day" || status === "half_day" ? "half" : status;
};

const calculateShiftHours = (startTime, endTime, fallback = 8) => {
  const parse = (value) => {
    const match = String(value || "").match(/^(\d{1,2}):(\d{2})/);
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
  };
  const start = parse(startTime);
  const end = parse(endTime);
  if (start === null || end === null) return fallback;
  let minutes = end - start;
  if (minutes <= 0) minutes += 24 * 60;
  return minutes > 0 ? minutes / 60 : fallback;
};

const calculateHourlyPayroll = ({
  attendanceRows = [],
  standardHoursPerDay = 8,
  hourlyRate = 0,
  overtimeHourlyRate = 0,
}) => {
  const daily = new Map();
  for (const row of attendanceRows) {
    const status = normalizeStatus(row.status);
    const worked = Number(row.hours_worked || 0);
    if (!row.check_out || !["present", "late", "grace", "half"].includes(status) || worked <= 0) continue;
    const day = row.day instanceof Date
      ? `${row.day.getFullYear()}-${String(row.day.getMonth() + 1).padStart(2, "0")}-${String(row.day.getDate()).padStart(2, "0")}`
      : String(row.day || row.check_in || "").slice(0, 10);
    if (!day) continue;
    const current = daily.get(day) || { worked: 0, reportedOvertime: 0 };
    current.worked += worked;
    current.reportedOvertime += Math.max(0, Number(row.overtime_hours || 0));
    daily.set(day, current);
  }

  let totalWorkedHours = 0;
  let overtimeHours = 0;
  for (const totals of daily.values()) {
    const worked = Math.max(0, totals.worked);
    const derivedOvertime = Math.max(0, worked - Number(standardHoursPerDay || 8));
    totalWorkedHours += worked;
    overtimeHours += Math.min(worked, Math.max(derivedOvertime, totals.reportedOvertime));
  }

  totalWorkedHours = roundTo2(totalWorkedHours);
  overtimeHours = roundTo2(overtimeHours);
  const normalHours = roundTo2(Math.max(0, totalWorkedHours - overtimeHours));
  const normalPay = roundTo2(normalHours * Number(hourlyRate || 0));
  // If no special overtime rate is configured, overtime remains payable at
  // the normal hourly rate instead of silently becoming unpaid time.
  const effectiveOvertimeRate = Number(overtimeHourlyRate || 0) > 0
    ? Number(overtimeHourlyRate)
    : Number(hourlyRate || 0);
  const overtimePay = roundTo2(overtimeHours * effectiveOvertimeRate);

  return {
    totalWorkedHours,
    normalHours,
    overtimeHours,
    normalPay,
    overtimePay,
    grossEarnings: roundTo2(normalPay + overtimePay),
  };
};

module.exports = { calculateHourlyPayroll, calculateShiftHours };
