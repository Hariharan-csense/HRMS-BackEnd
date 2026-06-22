// src/controllers/payrollController.js
const knex = require("../db/db");
const fs = require("fs");
const path = require("path");
const handlebars = require("handlebars");
const pdf = require("html-pdf");
const { sendEmailWithAttachment } = require("../utils/mailer"); // SMTP module

const hasAnyRole = (userLike, allowedRoles = []) => {
  const roleSet = new Set(
    [userLike?.role, ...(Array.isArray(userLike?.roles) ? userLike.roles : [])]
      .map((role) =>
        String(role || "")
          .toLowerCase()
          .trim(),
      )
      .filter(Boolean),
  );
  return allowedRoles
    .map((role) =>
      String(role || "")
        .toLowerCase()
        .trim(),
    )
    .some((role) => roleSet.has(role));
};

// Helper: Calculate Payable Days (company scoped)
const calculatePayableDays = async (employeeId, month, companyId) => {
  const [year, monthNum] = month.split("-").map(Number);
  const startDate = new Date(year, monthNum - 1, 1);
  const endDate = new Date(year, monthNum, 0);

  // Get attendance records (company scoped)
  const attendance = await knex("attendance")
    .where({ employee_id: employeeId, company_id: companyId })
    .whereBetween("check_in", [startDate.toISOString(), endDate.toISOString()])
    .select("status", "hours_worked");

  let payableDays = 0;
  attendance.forEach((record) => {
    if (record.status === "present") payableDays += 1;
    if (record.status === "half") payableDays += 0.5;
  });

  const holidayRows = await knex("holidays")
    .where({ company_id: companyId })
    .whereBetween("date", [formatDateKey(startDate), formatDateKey(endDate)])
    .select(knex.raw("DATE_FORMAT(date, '%Y-%m-%d') as day"));
  const holidayDateSet = new Set(holidayRows.map((r) => r.day).filter(Boolean));
  const isNonWorkingDay = (d, key = formatDateKey(d)) => {
    const day = d.getDay();
    return day === 0 || day === 6 || holidayDateSet.has(key);
  };

  // Add approved paid leaves (company scoped)
  const paidLeaves = await knex("leave_applications as la")
    .leftJoin("leave_types as lt", function () {
      this.on("lt.company_id", "=", "la.company_id").andOn(
        knex.raw(
          "(la.leave_type_id = lt.id OR LOWER(TRIM(la.leave_type_name)) = LOWER(TRIM(lt.name)))",
        ),
      );
    })
    .where({
      "la.company_id": companyId,
    })
    .andWhere(function () {
      this.where("la.employee_id", employeeId).orWhereRaw(
        "CAST(la.employee_id AS CHAR) = ?",
        [String(employeeId)],
      );
    })
    .whereRaw("LOWER(TRIM(la.status)) = ?", ["approved"])
    .andWhereRaw("la.from_date <= ? AND la.to_date >= ?", [endDate, startDate])
    .select(
      "la.from_date",
      "la.to_date",
      "la.days",
      "la.leave_type_name",
      "lt.is_paid",
    );

  const paidLeaveCreditByDate = calculatePaidLeaveCreditByDate(
    paidLeaves,
    startDate,
    endDate,
    () => false,
  );

  const overrideLeaves = await knex("attendance_overrides as ao")
    .leftJoin("attendance as a", "ao.attendance_id", "a.id")
    .leftJoin("leave_types as lt", function () {
      this.on("lt.company_id", "=", "ao.company_id").andOn(
        knex.raw(
          'LOWER(TRIM(lt.name)) = LOWER(TRIM(SUBSTRING_INDEX(SUBSTRING_INDEX(ao.reason, "]", 1), " - ", -1)))',
        ),
      );
    })
    .where({
      "ao.employee_id": employeeId,
      "ao.company_id": companyId,
      "ao.status": "approved",
    })
    .whereRaw("DATE(a.check_in) BETWEEN ? AND ?", [
      formatDateKey(startDate),
      formatDateKey(endDate),
    ])
    .andWhere(function () {
      this.where("ao.reason", "like", "[Paid Leave -%").orWhere(
        "ao.reason",
        "like",
        "[Half Day Leave -%",
      );
    })
    .select(
      "ao.reason",
      "lt.is_paid",
      knex.raw("DATE_FORMAT(a.check_in, '%Y-%m-%d') as override_date"),
    );

  addOverrideLeaveCredit(
    paidLeaveCreditByDate,
    overrideLeaves,
    isNonWorkingDay,
  );

  payableDays += sumLeaveCreditByDate(paidLeaveCreditByDate);

  return Math.round(payableDays);
};

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toBoolean = (value, fallback = false) => {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string")
    return value.toLowerCase() === "true" || value === "1";
  return fallback;
};

const calculateAmountFromPercentage = (base, percentage) => {
  return Number(((base * percentage) / 100).toFixed(2));
};

const roundTo2 = (value) => Number((Number(value) || 0).toFixed(2));

const normalizePayrollDayTotals = ({ totalDays, payableDays, lopDays }) => {
  const normalizedTotalDays = Math.max(0, roundTo2(totalDays));
  const normalizedLopDays = Math.min(
    normalizedTotalDays,
    Math.max(0, roundTo2(lopDays)),
  );
  const maxPayableDays = Math.max(
    0,
    roundTo2(normalizedTotalDays - normalizedLopDays),
  );
  const normalizedPayableDays = Math.min(
    maxPayableDays,
    Math.max(0, roundTo2(payableDays)),
  );

  return {
    totalDays: normalizedTotalDays,
    payableDays: normalizedPayableDays,
    lopDays: normalizedLopDays,
  };
};

const formatPayrollDayCount = (value) => {
  const numericValue = roundTo2(value);
  if (Number.isInteger(numericValue)) return String(numericValue);
  return numericValue.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
};

const getTdsPercentage = (structure) => {
  const explicitPercentage = toNumber(structure?.tds_percentage, NaN);
  if (Number.isFinite(explicitPercentage)) return explicitPercentage;

  // Legacy rows used `tds` directly. From now on that value is treated as a percentage.
  return toNumber(structure?.tds);
};

const clampDayForMonth = (year, monthIndex, day) => {
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  return Math.min(lastDay, Math.max(1, Number(day) || 1));
};

const formatDateKey = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const formatPayrollMonth = (month) => {
  const [year, monthNum] = String(month || "")
    .split("-")
    .map(Number);
  if (!year || !monthNum || monthNum < 1 || monthNum > 12) return month || "";

  return new Date(year, monthNum - 1, 1).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
  });
};

const formatDisplayDate = (date) => {
  if (!date) return "";
  return new Date(date).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

const formatPayrollPeriodLabel = (startDate, endDate) => {
  if (!startDate || !endDate) return "";
  return `${formatDisplayDate(startDate)} to ${formatDisplayDate(endDate)}`;
};

const numberToWords = (value) => {
  const ones = [
    "",
    "One",
    "Two",
    "Three",
    "Four",
    "Five",
    "Six",
    "Seven",
    "Eight",
    "Nine",
  ];
  const teens = [
    "Ten",
    "Eleven",
    "Twelve",
    "Thirteen",
    "Fourteen",
    "Fifteen",
    "Sixteen",
    "Seventeen",
    "Eighteen",
    "Nineteen",
  ];
  const tens = [
    "",
    "",
    "Twenty",
    "Thirty",
    "Forty",
    "Fifty",
    "Sixty",
    "Seventy",
    "Eighty",
    "Ninety",
  ];

  const belowHundred = (num) => {
    if (num < 10) return ones[num];
    if (num < 20) return teens[num - 10];
    return `${tens[Math.floor(num / 10)]}${num % 10 ? ` ${ones[num % 10]}` : ""}`;
  };

  const belowThousand = (num) => {
    if (num < 100) return belowHundred(num);
    return `${ones[Math.floor(num / 100)]} Hundred${num % 100 ? ` ${belowHundred(num % 100)}` : ""}`;
  };

  const integerPart = Math.floor(Math.abs(Number(value) || 0));
  if (integerPart === 0) return "Zero";

  const parts = [];
  const crore = Math.floor(integerPart / 10000000);
  const lakh = Math.floor((integerPart % 10000000) / 100000);
  const thousand = Math.floor((integerPart % 100000) / 1000);
  const rest = integerPart % 1000;

  if (crore) parts.push(`${belowThousand(crore)} Crore`);
  if (lakh) parts.push(`${belowThousand(lakh)} Lakh`);
  if (thousand) parts.push(`${belowThousand(thousand)} Thousand`);
  if (rest) parts.push(belowThousand(rest));

  return parts.join(" ");
};

const amountToWords = (value) => {
  const amount = Math.abs(Number(value) || 0);
  const rupees = Math.floor(amount);
  const paise = Math.round((amount - rupees) * 100);
  const rupeeWords = `${numberToWords(rupees)} Rupees`;
  const paiseWords = paise ? ` and ${numberToWords(paise)} Paise` : "";

  return `${rupeeWords}${paiseWords} Only`;
};

const getPayrollPeriod = (month, company) => {
  const [year, monthNum] = month.split("-").map(Number);

  // Example:
  // month = 2026-05
  // selectedMonthIndex = 4 (May)

  const selectedMonthIndex = monthNum - 1;

  const startDay = Math.min(
    31,
    Math.max(1, Number(company?.payroll_start_day) || 1),
  );

  const endDay = Math.min(
    31,
    Math.max(1, Number(company?.payroll_end_day) || 31),
  );

  let startYear = year;
  let startMonthIndex = selectedMonthIndex;

  let endYear = year;
  let endMonthIndex = selectedMonthIndex;

  // =====================================================
  // CROSS MONTH PAYROLL
  // Example:
  // Start = 26
  // End   = 25
  // May payroll =>
  // 26 Apr -> 25 May
  // =====================================================

  if (startDay > endDay) {
    startMonthIndex = selectedMonthIndex - 1;

    // January handling
    if (startMonthIndex < 0) {
      startMonthIndex = 11;
      startYear = year - 1;
    }
  }

  // =====================================================
  // BUILD DATES
  // =====================================================

  const startDate = new Date(
    startYear,

    startMonthIndex,

    clampDayForMonth(startYear, startMonthIndex, startDay),
  );

  const endDate = new Date(
    endYear,

    endMonthIndex,

    clampDayForMonth(endYear, endMonthIndex, endDay),
  );

  startDate.setHours(0, 0, 0, 0);

  endDate.setHours(23, 59, 59, 999);

  // =====================================================
  // TOTAL DAYS
  // =====================================================

  const totalDays =
    Math.floor((endDate.getTime() - startDate.getTime()) / 86400000) + 1;

  return {
    startDate,
    endDate,
    totalDays,
    startDay,
    endDay,
  };
};
const getEffectivePayrollEndDate = (startDate, endDate) => {
  const today = new Date();
  today.setHours(23, 59, 59, 999);

  if (today >= startDate && today < endDate) {
    return today;
  }

  return endDate;
};

const getInclusiveDayCount = (startDate, endDate) => {
  const start = new Date(startDate);
  const end = new Date(endDate);
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);

  if (end < start) return 0;
  return Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
};

const normalizeAttendanceStatus = (status) => {
  const s = String(status || "")
    .toLowerCase()
    .trim();
  if (s === "half-day" || s === "half_day") return "half";
  return s;
};

const getAttendanceRowTime = (row) => {
  const value = row?.updated_at || row?.created_at || row?.check_in;
  const parsed = value ? new Date(value).getTime() : 0;
  return Number.isFinite(parsed) ? parsed : 0;
};

const getLatestAttendanceRowsByDay = (attendanceRows) => {
  const latestByDay = new Map();

  for (const row of attendanceRows) {
    const dayKey =
      row.day instanceof Date
        ? formatDateKey(row.day)
        : String(row.day).slice(0, 10);
    if (!dayKey) continue;

    const existing = latestByDay.get(dayKey);
    if (
      !existing ||
      getAttendanceRowTime(row) > getAttendanceRowTime(existing) ||
      (getAttendanceRowTime(row) === getAttendanceRowTime(existing) &&
        Number(row.id || 0) > Number(existing.id || 0))
    ) {
      latestByDay.set(dayKey, row);
    }
  }

  return [...latestByDay.values()];
};

const generatePdfFromHtml = (html, pdfPath) => {
  return new Promise((resolve, reject) => {
    pdf
      .create(html, {
        format: "A4",
        border: {
          top: "8mm",
          right: "8mm",
          bottom: "8mm",
          left: "8mm",
        },
      })
      .toFile(pdfPath, (err, result) => {
        if (err) return reject(err);
        resolve(result);
      });
  });
};

const getNextNumericId = async (tableName) => {
  const result = await knex(tableName).max("id as maxId").first();
  return Number(result?.maxId || 0) + 1;
};

const isPaidLeaveType = (leave) => {
  if (leave?.is_paid !== undefined && leave?.is_paid !== null) {
    return (
      leave.is_paid === true ||
      leave.is_paid === 1 ||
      String(leave.is_paid) === "1"
    );
  }

  const normalizedName = String(
    leave?.leave_type_name || leave?.leaveType || "",
  ).toLowerCase();
  return (
    !normalizedName.includes("unpaid") &&
    !normalizedName.includes("loss of pay") &&
    normalizedName !== "lwp"
  );
};

const calculateLeaveCreditByDate = (
  leaves,
  startDate,
  effectiveEndDate,
  isNonWorkingDay,
  shouldCountLeave = () => true,
) => {
  const creditByDate = new Map();

  for (const leave of leaves) {
    if (!shouldCountLeave(leave)) continue;

    const from = new Date(leave.from_date);
    const to = new Date(leave.to_date);
    const current = new Date(Math.max(from.getTime(), startDate.getTime()));
    const end = new Date(Math.min(to.getTime(), effectiveEndDate.getTime()));
    const requestedDays = Number(leave.days || 0);

    current.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);

    const eligibleDates = [];
    while (current <= end) {
      const key = formatDateKey(current);
      if (!isNonWorkingDay(current, key)) {
        eligibleDates.push(key);
      }
      current.setDate(current.getDate() + 1);
    }

    if (!eligibleDates.length) continue;

    let remainingCredit =
      requestedDays > 0
        ? Math.min(requestedDays, eligibleDates.length)
        : eligibleDates.length;

    for (const key of eligibleDates) {
      if (remainingCredit <= 0) break;
      const credit = Math.min(1, remainingCredit);
      const existingCredit = Number(creditByDate.get(key) || 0);
      creditByDate.set(key, Math.max(existingCredit, credit));
      remainingCredit = roundTo2(remainingCredit - credit);
    }
  }

  return creditByDate;
};

const calculatePaidLeaveCreditByDate = (
  leaves,
  startDate,
  effectiveEndDate,
  isNonWorkingDay,
) =>
  calculateLeaveCreditByDate(
    leaves,
    startDate,
    effectiveEndDate,
    isNonWorkingDay,
    isPaidLeaveType,
  );

const calculateUnpaidLeaveCreditByDate = (
  leaves,
  startDate,
  effectiveEndDate,
  isNonWorkingDay,
) =>
  calculateLeaveCreditByDate(
    leaves,
    startDate,
    effectiveEndDate,
    isNonWorkingDay,
    (leave) => !isPaidLeaveType(leave),
  );

const sumLeaveCreditByDate = (creditByDate) =>
  roundTo2(
    [...creditByDate.values()].reduce(
      (sum, credit) => sum + Number(credit || 0),
      0,
    ),
  );

const mergeCreditByDate = (target, source) => {
  for (const [dateKey, credit] of source.entries()) {
    target.set(
      dateKey,
      Math.max(Number(target.get(dateKey) || 0), Number(credit || 0)),
    );
  }
  return target;
};

const calculatePaidLeaveDaysInPeriod = (
  leaves,
  startDate,
  effectiveEndDate,
  isNonWorkingDay,
) => {
  return sumLeaveCreditByDate(
    calculatePaidLeaveCreditByDate(
      leaves,
      startDate,
      effectiveEndDate,
      isNonWorkingDay,
    ),
  );
};

const parseOverrideLeave = (reason) => {
  const match = String(reason || "").match(
    /^\[(Paid Leave|Half Day Leave)\s+-\s+([^\]]+)\]/i,
  );
  if (!match) return null;

  return {
    mode: match[1].toLowerCase().includes("half") ? "half" : "paid",
    leaveTypeName: match[2].trim(),
  };
};

const addOverrideLeaveCredit = (creditByDate, overrides, isNonWorkingDay) => {
  for (const override of overrides) {
    const parsedLeave = parseOverrideLeave(override.reason);
    if (!parsedLeave || !isPaidLeaveType(override)) continue;

    const dateKey = String(override.override_date || "").slice(0, 10);
    if (!dateKey) continue;

    const date = new Date(`${dateKey}T00:00:00`);
    if (Number.isNaN(date.getTime()) || isNonWorkingDay(date, dateKey))
      continue;

    const credit = parsedLeave.mode === "half" ? 0.5 : 1;
    const existingCredit = Number(creditByDate.get(dateKey) || 0);
    creditByDate.set(dateKey, Math.max(existingCredit, credit));
  }

  return creditByDate;
};

const getOverrideDateKey = (override) =>
  String(override?.override_date || override?.attendance_date || "").slice(
    0,
    10,
  );

const applyApprovedAttendanceOverrides = ({
  overrides,
  attendanceCreditByDay,
  paidLeaveCreditByDate,
  lopCreditByDate,
  isNonWorkingDay,
}) => {
  for (const override of overrides) {
    const dateKey = getOverrideDateKey(override);
    if (!dateKey) continue;

    const date = new Date(`${dateKey}T00:00:00`);
    if (Number.isNaN(date.getTime())) continue;

    const parsedLeave = parseOverrideLeave(override.reason);
    if (parsedLeave) {
      if (isNonWorkingDay(date, dateKey)) continue;

      const credit = parsedLeave.mode === "half" ? 0.5 : 1;

      attendanceCreditByDay.delete(dateKey);
      paidLeaveCreditByDate.delete(dateKey);
      lopCreditByDate.delete(dateKey);

      if (isPaidLeaveType(override)) {
        paidLeaveCreditByDate.set(dateKey, credit);
      } else {
        lopCreditByDate.set(dateKey, credit);
      }
      continue;
    }
  }

  return {
    attendanceCreditByDay,
    paidLeaveCreditByDate,
    lopCreditByDate,
  };
};

const addMissingWorkingDayLopCredits = ({
  startDate,
  endDate,
  attendanceCreditByDay,
  paidLeaveCreditByDate,
  lopCreditByDate,
  isNonWorkingDay,
}) => {
  const current = new Date(startDate);
  current.setHours(0, 0, 0, 0);
  const last = new Date(endDate);
  last.setHours(0, 0, 0, 0);

  while (current <= last) {
    const dateKey = formatDateKey(current);

    if (
      !isNonWorkingDay(current, dateKey) &&
      !attendanceCreditByDay.has(dateKey) &&
      !paidLeaveCreditByDate.has(dateKey) &&
      !lopCreditByDate.has(dateKey)
    ) {
      lopCreditByDate.set(dateKey, 1);
    }

    current.setDate(current.getDate() + 1);
  }

  return lopCreditByDate;
};

const getApprovedAttendanceOverridesForPayroll = async ({
  employeeId,
  companyId,
  startDate,
  endDate,
}) => {
  return knex("attendance_overrides as ao")
    .leftJoin("attendance as a", "ao.attendance_id", "a.id")
    .leftJoin("leave_types as lt", function () {
      this.on("lt.company_id", "=", "ao.company_id").andOn(
        knex.raw(
          'LOWER(TRIM(lt.name)) = LOWER(TRIM(SUBSTRING_INDEX(SUBSTRING_INDEX(ao.reason, "]", 1), " - ", -1)))',
        ),
      );
    })
    .where({
      "ao.employee_id": employeeId,
      "ao.company_id": companyId,
      "ao.status": "approved",
    })
    .whereRaw("DATE(a.check_in) BETWEEN ? AND ?", [
      formatDateKey(startDate),
      formatDateKey(endDate),
    ])
    .select(
      "ao.reason",
      "ao.overridden_status",
      "ao.requested_check_in",
      "ao.requested_check_out",
      "lt.is_paid",
      knex.raw("DATE_FORMAT(a.check_in, '%Y-%m-%d') as override_date"),
    )
    .orderBy("ao.updated_at", "asc")
    .orderBy("ao.created_at", "asc");
};

const withOptionalColumn = async (tableName, payload, columnName, value) => {
  if (await knex.schema.hasColumn(tableName, columnName)) {
    payload[columnName] = value;
  }
  return payload;
};

const getImageMimeType = (filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".webp") return "image/webp";
  return "image/jpeg";
};

const assetPathToBase64 = (assetPath) => {
  if (!assetPath) return null;
  if (
    String(assetPath).startsWith("data:") ||
    String(assetPath).startsWith("http")
  ) {
    return assetPath;
  }

  const relativePath = String(assetPath).replace(/^\/+/, "");
  const candidates = [
    path.resolve(__dirname, "..", "..", relativePath),
    path.join(process.cwd(), "..", relativePath),
    path.join(process.cwd(), relativePath),
  ];
  const filePath = candidates.find((candidate) => fs.existsSync(candidate));

  if (!filePath) return null;

  const buffer = fs.readFileSync(filePath);
  return `data:${getImageMimeType(filePath)};base64,${buffer.toString("base64")}`;
};

// Save or Update Salary Structure (company scoped)
const saveSalaryStructure = async (req, res) => {
  const companyId = req.user.company_id;
  if (!companyId) {
    return res
      .status(400)
      .json({ message: "You are not assigned to any company" });
  }

  const {
    employee_id,
    gross,
    basic,
    hra = 0,
    lta = 0,
    allowances = 0,
    incentives = 0,
    pf = 0,
    pf_percentage,
    pf_enabled,
    esi = 0,
    esi_percentage,
    esi_enabled,
    pt = 0,
    tds = 0,
    tds_percentage,
    other_deductions = 0,
  } = req.body;

  if (!employee_id || !gross) {
    return res
      .status(400)
      .json({ message: "Employee ID and Gross Salary required" });
  }

  try {
    // Resolve employee using either employee code (EMP001) or numeric DB id.
    const normalizedEmployeeRef = String(employee_id || "").trim();
    const employeeRecord = await knex("employees")
      .where("company_id", companyId)
      .andWhere((qb) => {
        qb.whereRaw("LOWER(employee_id) = ?", [
          normalizedEmployeeRef.toLowerCase(),
        ]);
        if (/^\d+$/.test(normalizedEmployeeRef)) {
          qb.orWhere("id", Number(normalizedEmployeeRef));
        }
      })
      .first();

    if (!employeeRecord) {
      return res
        .status(404)
        .json({ message: "Employee not found or access denied" });
    }

    // Use the actual database ID for further operations
    const actualEmployeeId = employeeRecord.id;

    const grossAmount = toNumber(gross);
    const basicAmount = toNumber(basic);
    const hraAmount = toNumber(hra);
    const ltaAmount = toNumber(lta);
    const pfEnabled = toBoolean(
      pf_enabled,
      toNumber(pf) > 0 || toNumber(pf_percentage) > 0,
    );
    const esiEnabled = toBoolean(
      esi_enabled,
      toNumber(esi) > 0 || toNumber(esi_percentage) > 0,
    );
    const pfPercentage = toNumber(pf_percentage);
    const esiPercentage = toNumber(esi_percentage);
    const hasPfPercentage =
      pf_percentage !== undefined &&
      pf_percentage !== null &&
      pf_percentage !== "";
    const hasEsiPercentage =
      esi_percentage !== undefined &&
      esi_percentage !== null &&
      esi_percentage !== "";
    const pfAmount = pfEnabled
      ? hasPfPercentage
        ? calculateAmountFromPercentage(basicAmount, pfPercentage)
        : toNumber(pf)
      : 0;
    const esiAmount = esiEnabled
      ? hasEsiPercentage
        ? calculateAmountFromPercentage(basicAmount, esiPercentage)
        : toNumber(esi)
      : 0;
    const tdsPercentage = toNumber(tds_percentage ?? tds);

    const calculatedGross =
      grossAmount ||
      basicAmount +
        hraAmount +
        ltaAmount +
        toNumber(allowances) +
        toNumber(incentives);

    const existing = await knex("payroll_structures")
      .where({ employee_id: actualEmployeeId, company_id: companyId })
      .first();

    if (existing) {
      const updatePayload = await withOptionalColumn(
        "payroll_structures",
        {
          gross: calculatedGross,
          basic: basicAmount,
          hra: hraAmount,
          lta: ltaAmount,
          allowances: toNumber(allowances),
          incentives: toNumber(incentives),
          pf: pfAmount,
          esi: esiAmount,
          pt: toNumber(pt),
          tds: tdsPercentage,
          other_deductions: toNumber(other_deductions),
        },
        "tds_percentage",
        tdsPercentage,
      );

      // UPDATE
      await knex("payroll_structures")
        .where({ employee_id: actualEmployeeId, company_id: companyId })
        .update(updatePayload);

      const updated = await knex("payroll_structures")
        .where({ employee_id: actualEmployeeId, company_id: companyId })
        .first();

      res.json({
        success: true,
        message: "Salary structure updated successfully",
        structure: updated,
      });
    } else {
      // CREATE
      const nextId = await getNextNumericId("payroll_structures");

      const insertPayload = await withOptionalColumn(
        "payroll_structures",
        {
          id: nextId,
          company_id: companyId,
          employee_id: actualEmployeeId,
          gross: calculatedGross,
          basic: basicAmount,
          hra: hraAmount,
          lta: ltaAmount,
          allowances: toNumber(allowances),
          incentives: toNumber(incentives),
          pf: pfAmount,
          esi: esiAmount,
          pt: toNumber(pt),
          tds: tdsPercentage,
          other_deductions: toNumber(other_deductions),
        },
        "tds_percentage",
        tdsPercentage,
      );

      await knex("payroll_structures").insert(insertPayload);

      const newStructure = await knex("payroll_structures")
        .where({ employee_id: actualEmployeeId, company_id: companyId })
        .first();

      res.json({
        success: true,
        message: "Salary structure created successfully",
        structure: newStructure,
      });
    }
  } catch (error) {
    console.error("Save salary structure error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

const processPayroll = async (req, res) => {
  const companyId = req.user.company_id;

  if (!companyId) {
    return res
      .status(400)
      .json({ message: "You are not assigned to any company" });
  }

  const { employee_id, month } = req.body;

  if (!employee_id || !month) {
    return res.status(400).json({ message: "Employee ID and Month required" });
  }

  try {
    // ===============================
    // EMPLOYEE
    // ===============================
    const employee = await knex("employees")
      .where(function () {
        if (!isNaN(employee_id)) {
          this.where("id", employee_id);
        } else {
          this.where("employee_id", employee_id);
        }
      })
      .andWhere("company_id", companyId)
      .first();

    if (!employee) {
      return res.status(404).json({ message: "Employee not found" });
    }

    const empId = employee.id;

    // ===============================
    // DEPARTMENT & DESIGNATION
    // ===============================
    const department = await knex("departments")
      .where({ id: employee.department_id, company_id: companyId })
      .first();

    const designation = await knex("designations")
      .where({ id: employee.designation_id, company_id: companyId })
      .first();

    const branch = employee.branch_id
      ? await knex("branches")
          .where({ id: employee.branch_id, company_id: companyId })
          .first()
      : null;

    // ===============================
    // BANK DETAILS
    // ===============================
    const bankDetails = await knex("employee_bank_details")
      .where({ employee_id: empId, company_id: companyId })
      .first();

    // ===============================
    // SALARY STRUCTURE
    // ===============================
    const structure = await knex("payroll_structures")
      .where({ employee_id: empId, company_id: companyId })
      .first();

    if (!structure) {
      return res.status(400).json({ message: "Salary structure not found" });
    }

    const company = await knex("companies").where({ id: companyId }).first();

    // ===============================
    // PAYROLL PERIOD INFO
    // ===============================
    const [year, monthNum] = month.split("-").map(Number);
    const { startDate, endDate, totalDays } = getPayrollPeriod(month, company);
    const calculationEndDate = getEffectivePayrollEndDate(startDate, endDate);
    const elapsedPayrollDays = getInclusiveDayCount(
      startDate,
      calculationEndDate,
    );
    const payrollPeriod = formatPayrollPeriodLabel(startDate, endDate);

    // ===============================
    // MONTHLY GROSS
    // ===============================
    const componentGross = roundTo2(
      Number(structure.basic || 0) +
        Number(structure.hra || 0) +
        Number(structure.lta || 0) +
        Number(structure.allowances || 0) +
        Number(structure.incentives || 0),
    );
    const monthlyGross =
      componentGross > 0
        ? componentGross
        : roundTo2(Number(structure.gross || 0));

    // ===============================
    // ATTENDANCE (PRESENT)
    // ===============================
    const attendanceRows = await knex("attendance")
      .where({
        employee_id: empId,
        company_id: companyId,
      })
      .whereBetween("check_in", [startDate, calculationEndDate])
      .select(
        "id",
        "check_in",
        knex.raw("DATE(check_in) as day"),
        "status",
        "hours_worked",
        "flag_reason",
        "created_at",
        "updated_at",
      );

    const presentDateSet = new Set();
    const halfDayDateSet = new Set();
    const attendanceCreditByDay = new Map();
    const attendanceLeaveCreditByDate = new Map();
    const lopCreditByDate = new Map();

    const holidayRows = await knex("holidays")
      .where({ company_id: companyId })
      .whereBetween("date", [
        formatDateKey(startDate),
        formatDateKey(calculationEndDate),
      ])
      .select(knex.raw("DATE_FORMAT(date, '%Y-%m-%d') as day"));

    const holidayDateSet = new Set(
      holidayRows.map((r) => r.day).filter(Boolean),
    );

    const isWeekend = (d) => {
      const day = d.getDay();
      return day === 0 || day === 6;
    };
    const isNonWorkingDay = (d, key = formatDateKey(d)) =>
      isWeekend(d) || holidayDateSet.has(key);

    for (const row of getLatestAttendanceRowsByDay(attendanceRows)) {
      const dayKey =
        row.day instanceof Date
          ? formatDateKey(row.day)
          : String(row.day).slice(0, 10);
      if (!dayKey) continue;

      const dayObj = new Date(`${dayKey}T00:00:00`);
      const status = normalizeAttendanceStatus(row.status);

      if (status === "holiday" || status === "weekend") {
        holidayDateSet.add(dayKey);
        continue;
      }

      const nonWorkingDay = isNonWorkingDay(dayObj, dayKey);
      if (nonWorkingDay && !["present", "late", "half"].includes(status)) {
        continue;
      }

      let credit = 0;

      if (status === "absent") {
        lopCreditByDate.set(
          dayKey,
          Math.max(Number(lopCreditByDate.get(dayKey) || 0), 1),
        );
        credit = 0;
      } else if (status === "half") {
        lopCreditByDate.set(
          dayKey,
          Math.max(Number(lopCreditByDate.get(dayKey) || 0), 0.5),
        );
        credit = 0.5;
      } else if (status === "present" || status === "late") {
        credit = 1;
      } else if (status === "leave") {
        const leaveName = String(row.flag_reason || row.status || "");
        if (isPaidLeaveType({ leave_type_name: leaveName })) {
          attendanceLeaveCreditByDate.set(
            dayKey,
            Math.max(Number(attendanceLeaveCreditByDate.get(dayKey) || 0), 1),
          );
        }
        credit = 0;
      } else {
        // Fallback for legacy rows where status may be empty.
        const hoursWorked = Number(row.hours_worked || 0);
        credit = hoursWorked > 0 ? 1 : 0;
      }

      const existingCredit = attendanceCreditByDay.get(dayKey) || 0;
      if (credit > existingCredit) {
        attendanceCreditByDay.set(dayKey, credit);
      }
    }

    for (const [dayKey, credit] of attendanceCreditByDay.entries()) {
      if (credit >= 1) presentDateSet.add(dayKey);
      if (credit > 0 && credit < 1) halfDayDateSet.add(dayKey);
    }

    // ===============================
    // APPROVED LEAVES (PAID)
    // ===============================
    const approvedLeaves = await knex("leave_applications as la")
      .leftJoin("leave_types as lt", function () {
        this.on("lt.company_id", "=", "la.company_id").andOn(
          knex.raw(
            "(la.leave_type_id = lt.id OR LOWER(TRIM(la.leave_type_name)) = LOWER(TRIM(lt.name)))",
          ),
        );
      })
      .where({
        "la.company_id": companyId,
      })
      .andWhere(function () {
        this.where("la.employee_id", empId)
          .orWhereRaw("CAST(la.employee_id AS CHAR) = ?", [String(empId)])
          .orWhereRaw("CAST(la.employee_id AS CHAR) = ?", [
            String(employee.employee_id || ""),
          ]);
      })
      .whereRaw("LOWER(TRIM(la.status)) = ?", ["approved"])
      .andWhereRaw("la.from_date <= ? AND la.to_date >= ?", [
        calculationEndDate,
        startDate,
      ])
      .select(
        "la.from_date",
        "la.to_date",
        "la.days",
        "la.leave_type_name",
        "lt.is_paid",
      );

    const paidLeaveCreditByDate = calculatePaidLeaveCreditByDate(
      approvedLeaves,
      startDate,
      calculationEndDate,
      () => false,
    );
    const unpaidLeaveCreditByDate = calculateUnpaidLeaveCreditByDate(
      approvedLeaves,
      startDate,
      calculationEndDate,
      () => false,
    );
    mergeCreditByDate(lopCreditByDate, unpaidLeaveCreditByDate);

    for (const [dateKey, credit] of attendanceLeaveCreditByDate.entries()) {
      paidLeaveCreditByDate.set(
        dateKey,
        Math.max(Number(paidLeaveCreditByDate.get(dateKey) || 0), credit),
      );
    }

    const approvedAttendanceOverrides =
      await getApprovedAttendanceOverridesForPayroll({
        employeeId: empId,
        companyId,
        startDate,
        endDate: calculationEndDate,
      });

    applyApprovedAttendanceOverrides({
      overrides: approvedAttendanceOverrides,
      attendanceCreditByDay,
      paidLeaveCreditByDate,
      lopCreditByDate,
      isNonWorkingDay,
    });

    presentDateSet.clear();
    halfDayDateSet.clear();
    for (const [dayKey, credit] of attendanceCreditByDay.entries()) {
      if (credit >= 1) presentDateSet.add(dayKey);
      if (credit > 0 && credit < 1) halfDayDateSet.add(dayKey);
    }

    addMissingWorkingDayLopCredits({
      startDate,
      endDate: calculationEndDate,
      attendanceCreditByDay,
      paidLeaveCreditByDate,
      lopCreditByDate,
      isNonWorkingDay,
    });

    const approvedLeaveDays = sumLeaveCreditByDate(paidLeaveCreditByDate);

    const presentDays = presentDateSet.size;
    const halfDays = roundTo2(halfDayDateSet.size * 0.5);
    const explicitLopDays = sumLeaveCreditByDate(lopCreditByDate);
    const calculatedPayableDays = Math.max(
      0,
      roundTo2(elapsedPayrollDays - explicitLopDays),
    );
    const normalizedDayTotals = normalizePayrollDayTotals({
      totalDays: elapsedPayrollDays,
      payableDays: calculatedPayableDays,
      lopDays: explicitLopDays,
    });
    const payableDays = normalizedDayTotals.payableDays;
    const lopDays = normalizedDayTotals.lopDays;
    const futurePeriodDays = Math.max(
      0,
      roundTo2(totalDays - normalizedDayTotals.totalDays),
    );
    const dailyGross = totalDays > 0 ? monthlyGross / totalDays : 0;
    const lopAmount = roundTo2(dailyGross * lopDays);
    const futurePeriodAmount = roundTo2(dailyGross * futurePeriodDays);
    const earnedGross = roundTo2(dailyGross * payableDays);

    const tdsPercentage = getTdsPercentage(structure);
    const tdsAmount = calculateAmountFromPercentage(
      monthlyGross,
      tdsPercentage,
    );
    const monthlyDeductions = roundTo2(
      Number(structure.pf || 0) +
        Number(structure.esi || 0) +
        Number(structure.pt || 0) +
        tdsAmount +
        Number(structure.other_deductions || 0),
    );

    // ===============================
    // EXPENSES
    // ===============================
    const expenses = await knex("expenses")
      .where({ employee_id: empId, company_id: companyId, status: "approved" })
      .whereBetween("expense_date", [
        formatDateKey(startDate),
        formatDateKey(calculationEndDate),
      ]);

    const totalExpenses = expenses.reduce(
      (sum, e) => sum + Number(e.amount || 0),
      0,
    );

    let monthlyNet = earnedGross - monthlyDeductions + totalExpenses;
    monthlyNet = roundTo2(monthlyNet);

    // Ensure net doesn't go negative due to calculation errors
    if (monthlyNet < 0) {
      console.warn(
        `Negative net salary calculated for employee ${empId}: ${monthlyNet}`,
      );
      console.warn(
        `Gross: ${monthlyGross}, Earned Gross: ${earnedGross}, Deductions: ${monthlyDeductions}, LOP: ${lopAmount}, Future Period: ${futurePeriodAmount}, Expenses: ${totalExpenses}`,
      );

      // Fix: Set net to 0 if it goes negative (employee can't have negative salary)
      monthlyNet = 0;
    }

    // ===============================
    // ANNUAL
    // ===============================
    const annualGross = roundTo2(monthlyGross * 12);
    const annualDeductions = roundTo2(monthlyDeductions * 12);
    const annualNet = roundTo2(monthlyNet * 12);

    // ===============================
    // SAVE PAYROLL
    // ===============================
    const payrollData = await withOptionalColumn(
      "payroll_processing",
      {
        employee_id: empId,
        company_id: companyId,
        month,
        total_days: totalDays,
        present_days: presentDateSet.size,
        approved_leave_days: approvedLeaveDays,
        payable_days: payableDays,
        lop_days: lopDays,
        lop_amount: lopAmount,
        gross: monthlyGross,
        deductions: monthlyDeductions,
        net: monthlyNet,
        total_expenses: totalExpenses,
        annual_gross: annualGross,
        annual_deductions: annualDeductions,
        annual_net: annualNet,
        status: "processed",
      },
      "tds_amount",
      tdsAmount,
    );

    const existing = await knex("payroll_processing")
      .where({ employee_id: empId, company_id: companyId, month })
      .first();

    if (existing) {
      await knex("payroll_processing")
        .where({ id: existing.id })
        .update(payrollData);
    } else {
      await knex("payroll_processing").insert(payrollData);
    }

    // ===============================
    // COMPANY BRAND ASSETS
    // ===============================
    const companyLogoBase64 = assetPathToBase64(company?.logo);
    const companySignatureBase64 = assetPathToBase64(company?.signature);

    // ===============================
    // PDF GENERATION
    // ===============================
    const templatePath = path.join(__dirname, "..", "templates", "payslip.hbs");
    const template = handlebars.compile(fs.readFileSync(templatePath, "utf-8"));

    const html = template({
      company_name: company.company_name,
      company_logo: companyLogoBase64,
      company_signature: companySignatureBase64,
      company_address: company.address,

      employee_code: employee.employee_id || "",
      employee_name: `${employee.first_name} ${employee.last_name || ""}`,
      department_name: department?.name || "-",
      designation_name: designation?.name || "-",
      branch_name: branch?.name || employee.location_office || "-",

      esi_number: employee.esic || "",
      uan_number: employee.uan || "",

      bank_name: bankDetails?.bank_name || "",
      account_no: bankDetails?.account_number || "",
      ifsc_code: bankDetails?.ifsc_code || "",

      month,
      display_month: formatPayrollMonth(month),
      payroll_period: payrollPeriod,
      total_days: formatPayrollDayCount(totalDays),
      present_days: formatPayrollDayCount(presentDateSet.size),
      approved_leave_days: formatPayrollDayCount(approvedLeaveDays),
      lop_days: formatPayrollDayCount(lopDays),
      payable_days: formatPayrollDayCount(payableDays),

      basic: structure.basic,
      hra: structure.hra,
      lta: structure.lta,
      allowances: structure.allowances,
      incentives: structure.incentives,
      total_expenses: totalExpenses,

      pf: structure.pf,
      esi: structure.esi,
      pt: structure.pt,
      tds: tdsAmount,
      tds_percentage: tdsPercentage,
      other_deductions: structure.other_deductions,

      gross: monthlyGross,
      monthly_net: monthlyNet,
      monthly_net_words: amountToWords(monthlyNet),
      monthly_deductions: monthlyDeductions,
      annual_gross: annualGross,
      annual_deductions: annualDeductions,
      annual_net: annualNet,
      current_date: new Date().toISOString().slice(0, 10),
    });

    const pdfDir = path.join(__dirname, "temp");
    if (!fs.existsSync(pdfDir)) fs.mkdirSync(pdfDir, { recursive: true });

    const pdfPath = path.join(pdfDir, `payslip-${empId}-${month}.pdf`);

    await generatePdfFromHtml(html, pdfPath);

    // ===============================
    // SEND EMAIL
    // ===============================
    await sendEmailWithAttachment(
      employee.email,
      `Payslip for ${month}`,
      `Dear ${employee.first_name}, Please find your payslip attached.`,
      pdfPath,
      `payslip-${month}.pdf`,
    );

    fs.unlinkSync(pdfPath);

    return res.json({
      success: true,
      message: "Payroll processed & email sent successfully",
      payroll: payrollData,
    });
  } catch (error) {
    console.error("Process payroll error:", error);
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};

const updatePayrollStatus = async (req, res) => {
  const companyId = req.user.company_id;
  if (!companyId) {
    return res
      .status(400)
      .json({ message: "You are not assigned to any company" });
  }

  const { id } = req.params;
  const { status } = req.body;

  if (!["draft", "processed", "paid"].includes(status)) {
    return res.status(400).json({ message: "Invalid status" });
  }

  try {
    const payroll = await knex("payroll_processing")
      .where({ id, company_id: companyId })
      .first();

    if (!payroll) {
      return res
        .status(404)
        .json({ message: "Payroll record not found or access denied" });
    }

    await knex("payroll_processing").where({ id }).update({ status });

    const updated = await knex("payroll_processing").where({ id }).first();

    res.json({
      success: true,
      message: `Payroll status updated to ${status}`,
      payroll: updated,
    });
  } catch (error) {
    console.error("Update payroll status error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// Get Payroll Records (company scoped + role-based)
const getPayrollRecords = async (req, res) => {
  const companyId = req.user.company_id;
  if (!companyId) {
    return res
      .status(400)
      .json({ message: "You are not assigned to any company" });
  }

  try {
    let query = knex("payroll_processing")
      .leftJoin("employees", "payroll_processing.employee_id", "employees.id")
      .where("payroll_processing.company_id", companyId)
      .select(
        "payroll_processing.*",
        "employees.first_name",
        "employees.last_name",
        "employees.employee_id as employee_code",
      )
      .orderBy("month", "desc");

    if (
      hasAnyRole(req.user, ["employee"]) &&
      !hasAnyRole(req.user, [
        "manager",
        "hr",
        "finance",
        "admin",
        "ceo",
        "superadmin",
      ])
    ) {
      query = query.where("payroll_processing.employee_id", req.user.id);
    } else if (hasAnyRole(req.user, ["manager"])) {
      query = query.where((builder) => {
        builder
          .where("payroll_processing.employee_id", req.user.id)
          .orWhereExists(function () {
            this.select(1)
              .from("employees as team")
              .where("team.company_id", companyId)
              .whereRaw('team.manager_name = CONCAT(?, " ", COALESCE(?, ""))', [
                req.user.first_name || "",
                req.user.last_name || "",
              ])
              .whereRaw("team.id = payroll_processing.employee_id");
          });
      });
    }
    // Admin/HR/Finance sees all in company

    const records = (await query).map((record) => {
      const dayTotals = normalizePayrollDayTotals({
        totalDays: record.total_days,
        payableDays: record.payable_days,
        lopDays: record.lop_days,
      });

      return {
        ...record,
        total_days: dayTotals.totalDays,
        payable_days: dayTotals.payableDays,
        lop_days: dayTotals.lopDays,
      };
    });

    res.json({
      success: true,
      payrolls: records,
    });
  } catch (error) {
    console.error("Get payroll error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// const payslipPreview = async (req, res) => {
//   const companyId = req.user.company_id;
//   const { employee_id, month } = req.params;

//   if (!companyId) {
//     return res.status(400).json({ message: 'Company not assigned' });
//   }

//   try {
//     // ===============================
//     // EMPLOYEE (FIXED)
//     // ===============================
//     const employee = await knex('employees')
//       .where({ id: employee_id, company_id: companyId })
//       .first();

//     if (!employee) {
//       return res.status(404).json({ message: 'Employee not found' });
//     }

//     // ===============================
//     // BANK DETAILS
//     // ===============================
//     const bankDetails = await knex('employee_bank_details')
//       .where({ employee_id, company_id: companyId })
//       .first();

//     // ===============================
//     // PAYROLL DATA
//     // ===============================
//     const payroll = await knex('payroll_processing')
//       .where({ employee_id, company_id: companyId, month })
//       .first();

//     if (!payroll) {
//       return res.status(404).json({
//         message: 'Payroll not processed for this month'
//       });
//     }

//     // ===============================
//     // SALARY STRUCTURE
//     // ===============================
//     const structure = await knex('payroll_structures')
//       .where({ employee_id, company_id: companyId })
//       .first();

//     // ===============================
//     // COMPANY
//     // ===============================
//     const company = await knex('companies')
//       .where({ id: companyId })
//       .first();

//       let companyLogoBase64 = null;

// if (company?.logo) {
//   // remove leading slash if exists
//   const relativeLogoPath = company.logo.replace(/^\/+/, '');

//   // ⬅️ GO ONE LEVEL UP FROM backend
//   const logoPath = path.join(
//     process.cwd(),
//     '..',                   // <-- this is the FIX
//     relativeLogoPath
//   );

//   console.log('Resolved Logo Path:', logoPath);

//   if (fs.existsSync(logoPath)) {
//     const ext = path.extname(logoPath).toLowerCase();
//     const mimeType =
//       ext === '.png' ? 'image/png' :
//       ext === '.svg' ? 'image/svg+xml' :
//       'image/jpeg';

//     const buffer = fs.readFileSync(logoPath);
//     companyLogoBase64 = `data:${mimeType};base64,${buffer.toString('base64')}`;
//   } else {
//     console.log('❌ Logo file not found at:', logoPath);
//   }
// }

// const department = await knex('departments')
//       .where({ id: companyId })
//       .first();

//       const designation = await knex('designations')
//       .where({ id: companyId })
//       .first();
//     // ===============================
//     // TEMPLATE DATA
//     // ===============================
//     const templateData = {
//       company_name: company.company_name,
//       company_logo: companyLogoBase64,
//       company_address: company.address,

//       employee_name: `${employee.first_name} ${employee.last_name || ''}`,
//       department_name: department?.name || '-',
//       designation_name: designation?.name || '-',

//       esi_number: employee.esic || '',
//       uan_number: employee.uan || '',

//       bank_name: bankDetails?.bank_name || '',
//       account_no: bankDetails?.account_number || '',
//       ifsc_code: bankDetails?.ifsc_code || '',

//       month,
//       total_days: totalDays,
//       present_days: presentDays,
//       payable_days: payableDays,
//       approved_leave_days: leaveDays,
//       lop_days: lopDays,

//       basic: structure.basic,
//       hra: structure.hra,
//       allowances: structure.allowances,
//       incentives: structure.incentives,
//       total_expenses: totalExpenses,

//       pf: structure.pf,
//       esi: structure.esi,
//       pt: structure.pt,
//       tds: structure.tds,
//       other_deductions: structure.other_deductions,

//       monthly_net: monthlyNet,
//       monthly_deductions: monthlyDeductions,
//       annual_gross: annualGross,
//       annual_deductions: annualDeductions,
//       annual_net: annualNet
//     };

//     const templatePath = path.join(__dirname, '..', 'templates', 'payslip.hbs');
//     const templateHtml = fs.readFileSync(templatePath, 'utf-8');
//     const template = handlebars.compile(templateHtml);

//     const html = template(templateData);

//     res.setHeader('Content-Type', 'text/html');
//     return res.send(html);

//   } catch (error) {
//     console.error('Payslip preview error:', error);
//     return res.status(500).json({
//       message: 'Server error',
//       error: error.message
const payslipPreview = async (req, res) => {
  const companyId = req.user.company_id;
  const { employee_id, month } = req.params;

  if (!companyId) {
    return res
      .status(400)
      .json({ message: "You are not assigned to any company" });
  }

  // 🔒 Employee access control
  if (
    hasAnyRole(req.user, ["employee"]) &&
    !hasAnyRole(req.user, [
      "manager",
      "hr",
      "finance",
      "admin",
      "ceo",
      "superadmin",
    ]) &&
    employee_id != req.user.id
  ) {
    return res.status(403).json({ message: "Access denied" });
  }

  try {
    // ===============================
    // EMPLOYEE FETCH (same logic as POST)
    // ===============================
    const employee = await knex("employees")
      .where(function () {
        if (!isNaN(employee_id)) {
          this.where("id", employee_id);
        } else {
          this.where("employee_id", employee_id);
        }
      })
      .andWhere("company_id", companyId)
      .first();

    if (!employee) {
      return res.status(404).json({ message: "Employee not found" });
    }

    const empId = employee.id;

    // ===============================
    // PAYROLL DATA (🔥 MAIN SOURCE)
    // ===============================
    const payroll = await knex("payroll_processing")
      .where({ employee_id: empId, company_id: companyId, month })
      .first();

    if (!payroll) {
      return res.status(404).json({
        message: "Payroll not processed for this month",
      });
    }

    // ===============================
    // DEPARTMENT & DESIGNATION
    // ===============================
    const department = await knex("departments")
      .where({ id: employee.department_id, company_id: companyId })
      .first();

    const designation = await knex("designations")
      .where({ id: employee.designation_id, company_id: companyId })
      .first();

    const branch = employee.branch_id
      ? await knex("branches")
          .where({ id: employee.branch_id, company_id: companyId })
          .first()
      : null;

    // ===============================
    // BANK DETAILS
    // ===============================
    const bankDetails = await knex("employee_bank_details")
      .where({ employee_id: empId, company_id: companyId })
      .first();

    const structure = await knex("payroll_structures")
      .where({ employee_id: empId, company_id: companyId })
      .first();

    // ===============================
    // COMPANY + LOGO BASE64
    // ===============================
    const company = await knex("companies").where({ id: companyId }).first();

    const companyLogoBase64 = assetPathToBase64(company?.logo);
    const companySignatureBase64 = assetPathToBase64(company?.signature);
    const { startDate, endDate } = getPayrollPeriod(month, company);
    const calculationEndDate = getEffectivePayrollEndDate(startDate, endDate);

    const previewPaidLeaves = await knex("leave_applications as la")
      .leftJoin("leave_types as lt", function () {
        this.on("lt.company_id", "=", "la.company_id").andOn(
          knex.raw(
            "(la.leave_type_id = lt.id OR LOWER(TRIM(la.leave_type_name)) = LOWER(TRIM(lt.name)))",
          ),
        );
      })
      .where({ "la.company_id": companyId })
      .andWhere(function () {
        this.where("la.employee_id", empId)
          .orWhereRaw("CAST(la.employee_id AS CHAR) = ?", [String(empId)])
          .orWhereRaw("CAST(la.employee_id AS CHAR) = ?", [
            String(employee.employee_id || ""),
          ]);
      })
      .whereRaw("LOWER(TRIM(la.status)) = ?", ["approved"])
      .andWhereRaw("la.from_date <= ? AND la.to_date >= ?", [
        calculationEndDate,
        startDate,
      ])
      .select(
        "la.from_date",
        "la.to_date",
        "la.days",
        "la.leave_type_name",
        "lt.is_paid",
      );

    const previewPaidLeaveCreditByDate = calculatePaidLeaveCreditByDate(
      previewPaidLeaves,
      startDate,
      calculationEndDate,
      () => false,
    );
    const previewOverrideLeaves = await knex("attendance_overrides as ao")
      .leftJoin("attendance as a", "ao.attendance_id", "a.id")
      .leftJoin("leave_types as lt", function () {
        this.on("lt.company_id", "=", "ao.company_id").andOn(
          knex.raw(
            'LOWER(TRIM(lt.name)) = LOWER(TRIM(SUBSTRING_INDEX(SUBSTRING_INDEX(ao.reason, "]", 1), " - ", -1)))',
          ),
        );
      })
      .where({
        "ao.employee_id": empId,
        "ao.company_id": companyId,
        "ao.status": "approved",
      })
      .whereRaw("DATE(a.check_in) BETWEEN ? AND ?", [
        formatDateKey(startDate),
        formatDateKey(calculationEndDate),
      ])
      .andWhere(function () {
        this.where("ao.reason", "like", "[Paid Leave -%").orWhere(
          "ao.reason",
          "like",
          "[Half Day Leave -%",
        );
      })
      .select(
        "ao.reason",
        "lt.is_paid",
        knex.raw("DATE_FORMAT(a.check_in, '%Y-%m-%d') as override_date"),
      );

    addOverrideLeaveCredit(
      previewPaidLeaveCreditByDate,
      previewOverrideLeaves,
      () => false,
    );
    const previewPaidLeaveDays = sumLeaveCreditByDate(
      previewPaidLeaveCreditByDate,
    );
    const displayPaidLeaveDays = Number(payroll.approved_leave_days || 0);
    const displayDayTotals = normalizePayrollDayTotals({
      totalDays: payroll.total_days,
      payableDays: payroll.payable_days,
      lopDays: payroll.lop_days,
    });

    // ===============================
    // TEMPLATE DATA (🔥 SAME FIELDS)
    // ===============================
    const templateData = {
      company_name: company.company_name,
      company_logo: companyLogoBase64,
      company_signature: companySignatureBase64,
      company_address: company.address,

      employee_code: employee.employee_id || "",
      employee_name: `${employee.first_name} ${employee.last_name || ""}`,
      department_name: department?.name || "-",
      designation_name: designation?.name || "-",
      branch_name: branch?.name || employee.location_office || "-",

      esi_number: employee.esic || "",
      uan_number: employee.uan || "",

      bank_name: bankDetails?.bank_name || "",
      account_no: bankDetails?.account_number || "",
      ifsc_code: bankDetails?.ifsc_code || "",

      month,
      display_month: formatPayrollMonth(month),
      payroll_period: formatPayrollPeriodLabel(startDate, endDate),
      total_days: formatPayrollDayCount(displayDayTotals.totalDays),
      present_days: formatPayrollDayCount(payroll.present_days),
      payable_days: formatPayrollDayCount(displayDayTotals.payableDays),
      approved_leave_days: formatPayrollDayCount(displayPaidLeaveDays),
      lop_days: formatPayrollDayCount(displayDayTotals.lopDays),

      // 🔥 Salary Snapshot (from payroll_processing)
      basic: structure?.basic || 0,
      hra: structure?.hra,
      lta: structure?.lta || 0,
      allowances: structure?.allowances,
      incentives: structure?.incentives,
      total_expenses: payroll.total_expenses || 0,

      pf: structure?.pf,
      esi: structure?.esi,
      pt: structure?.pt,
      tds: payroll.tds_amount || 0,
      tds_percentage: getTdsPercentage(structure),
      other_deductions: structure?.other_deductions,

      gross: payroll.gross,
      monthly_net: payroll.net,
      monthly_net_words: amountToWords(payroll.net),
      monthly_deductions: payroll.deductions,
      annual_gross: payroll.annual_gross,
      annual_deductions: payroll.annual_deductions,
      annual_net: payroll.annual_net,
      current_date: new Date().toISOString().slice(0, 10),
    };

    // ===============================
    // HTML PREVIEW
    // ===============================
    const templatePath = path.join(__dirname, "..", "templates", "payslip.hbs");
    const template = handlebars.compile(fs.readFileSync(templatePath, "utf-8"));

    const html = template(templateData);

    res.setHeader("Content-Type", "text/html");
    return res.send(html);
  } catch (error) {
    console.error("Payslip preview error:", error);
    return res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

const getSalaryStructures = async (req, res) => {
  const companyId = req.user.company_id;
  if (!companyId) {
    return res
      .status(400)
      .json({ message: "You are not assigned to any company" });
  }

  try {
    const salaryStructures = await knex("payroll_structures")
      .where({ company_id: companyId })
      .select("*")
      .orderBy("created_at", "desc");

    // Get employee details for each structure
    const structuresWithEmployeeDetails = await Promise.all(
      salaryStructures.map(async (structure) => {
        const employee = await knex("employees")
          .where({ id: structure.employee_id, company_id: companyId })
          .select("first_name", "last_name", "employee_id as emp_id")
          .first();

        return {
          ...structure,
          pf_enabled: Number(structure.pf || 0) > 0,
          pf_percentage:
            Number(structure.basic || 0) > 0
              ? Number(
                  (
                    (Number(structure.pf || 0) / Number(structure.basic || 0)) *
                    100
                  ).toFixed(2),
                )
              : 0,
          esi_enabled: Number(structure.esi || 0) > 0,
          esi_percentage:
            Number(structure.basic || 0) > 0
              ? Number(
                  (
                    (Number(structure.esi || 0) /
                      Number(structure.basic || 0)) *
                    100
                  ).toFixed(2),
                )
              : 0,
          tds_percentage: getTdsPercentage(structure),
          employee_name: employee
            ? `${employee.first_name} ${employee.last_name}`
            : "N/A",
          employee_code: employee?.emp_id || "N/A",
        };
      }),
    );

    res.json(structuresWithEmployeeDetails);
  } catch (error) {
    console.error("Error fetching salary structures:", error);
    res.status(500).json({
      message: "Error fetching salary structures",
      error: error.message,
    });
  }
};

const updateSalaryStructure = async (req, res) => {
  const companyId = req.user.company_id;
  const { id } = req.params; // payroll_structures.id

  if (!companyId) {
    return res
      .status(400)
      .json({ message: "You are not assigned to any company" });
  }

  const {
    basic,
    hra = 0,
    lta = 0,
    allowances = 0,
    incentives = 0,
    pf = 0,
    pf_percentage,
    pf_enabled,
    esi = 0,
    esi_percentage,
    esi_enabled,
    pt = 0,
    tds = 0,
    tds_percentage,
    other_deductions = 0,
  } = req.body;

  if (!basic) {
    return res.status(400).json({ message: "Basic salary is required" });
  }

  try {
    // Check structure exists for this company
    const structure = await knex("payroll_structures")
      .where({ id, company_id: companyId })
      .first();

    if (!structure) {
      return res
        .status(404)
        .json({ message: "Salary structure not found or access denied" });
    }

    const basicAmount = toNumber(basic);
    const pfEnabled = toBoolean(
      pf_enabled,
      toNumber(pf) > 0 || toNumber(pf_percentage) > 0,
    );
    const esiEnabled = toBoolean(
      esi_enabled,
      toNumber(esi) > 0 || toNumber(esi_percentage) > 0,
    );
    const pfPercentage = toNumber(pf_percentage);
    const esiPercentage = toNumber(esi_percentage);
    const hasPfPercentage =
      pf_percentage !== undefined &&
      pf_percentage !== null &&
      pf_percentage !== "";
    const hasEsiPercentage =
      esi_percentage !== undefined &&
      esi_percentage !== null &&
      esi_percentage !== "";
    const pfAmount = pfEnabled
      ? hasPfPercentage
        ? calculateAmountFromPercentage(basicAmount, pfPercentage)
        : toNumber(pf)
      : 0;
    const esiAmount = esiEnabled
      ? hasEsiPercentage
        ? calculateAmountFromPercentage(basicAmount, esiPercentage)
        : toNumber(esi)
      : 0;
    const tdsPercentage = toNumber(tds_percentage ?? tds);

    const gross =
      basicAmount +
      toNumber(hra) +
      toNumber(lta) +
      toNumber(allowances) +
      toNumber(incentives);

    const updatePayload = await withOptionalColumn(
      "payroll_structures",
      {
        basic: basicAmount,
        hra: toNumber(hra),
        lta: toNumber(lta),
        allowances: toNumber(allowances),
        incentives: toNumber(incentives),
        gross,
        pf: pfAmount,
        esi: esiAmount,
        pt: toNumber(pt),
        tds: tdsPercentage,
        other_deductions: toNumber(other_deductions),
        updated_at: knex.fn.now(),
      },
      "tds_percentage",
      tdsPercentage,
    );

    await knex("payroll_structures")
      .where({ id, company_id: companyId })
      .update(updatePayload);

    const updated = await knex("payroll_structures")
      .where({ id, company_id: companyId })
      .first();

    res.json({
      success: true,
      message: "Salary structure updated successfully",
      structure: updated,
    });
  } catch (error) {
    console.error("Update salary structure error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

const deleteSalaryStructure = async (req, res) => {
  const companyId = req.user.company_id;
  const { id } = req.params; // payroll_structures.id

  if (!companyId) {
    return res
      .status(400)
      .json({ message: "You are not assigned to any company" });
  }

  try {
    // Check structure exists for this company
    const structure = await knex("payroll_structures")
      .where({ id, company_id: companyId })
      .first();

    if (!structure) {
      return res
        .status(404)
        .json({ message: "Salary structure not found or access denied" });
    }

    // Optional safety check: prevent delete if payroll already processed
    // const payrollExists = await knex('payrolls')
    //   .where({ employee_id: structure.employee_id, company_id: companyId })
    //   .first();
    // if (payrollExists) {
    //   return res.status(400).json({ message: 'Cannot delete salary structure with processed payroll' });
    // }

    await knex("payroll_structures").where({ id, company_id: companyId }).del();

    res.json({
      success: true,
      message: "Salary structure deleted successfully",
    });
  } catch (error) {
    console.error("Delete salary structure error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

const deletePayslip = async (req, res) => {
  const companyId = req.user.company_id;
  const { id } = req.params;

  if (!companyId) {
    return res
      .status(400)
      .json({ message: "You are not assigned to any company" });
  }

  try {
    const payslip = await knex("payroll_processing")
      .where({ id, company_id: companyId })
      .first();

    if (!payslip) {
      return res
        .status(404)
        .json({ message: "Payslip not found or access denied" });
    }

    await knex("payroll_processing").where({ id, company_id: companyId }).del();

    res.json({
      success: true,
      message: "Payslip deleted successfully",
    });
  } catch (error) {
    console.error("Delete payslip error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

const deletePayrollProcessing = async (req, res) => {
  const companyId = req.user.company_id;
  const { id } = req.params;

  if (!companyId) {
    return res
      .status(400)
      .json({ message: "You are not assigned to any company" });
  }

  try {
    const record = await knex("payroll_processing")
      .where({ id, company_id: companyId })
      .first();

    if (!record) {
      return res.status(404).json({
        message: "Payroll processing record not found or access denied",
      });
    }

    await knex("payroll_processing").where({ id, company_id: companyId }).del();

    return res.json({
      success: true,
      message: "Payroll processing record deleted successfully",
    });
  } catch (error) {
    console.error("Delete payroll processing error:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

// Get Employee Payslips (for employees to see their own payslips only)
const getEmployeePayslips = async (req, res) => {
  const companyId = req.user.company_id;
  if (!companyId) {
    return res
      .status(400)
      .json({ message: "You are not assigned to any company" });
  }

  try {
    const records = await knex("payroll_processing")
      .leftJoin("employees", "payroll_processing.employee_id", "employees.id")
      .where("payroll_processing.employee_id", req.user.id)
      .where("payroll_processing.company_id", companyId)
      .select(
        "payroll_processing.*",
        "employees.first_name",
        "employees.last_name",
        "employees.employee_id as employee_code",
      )
      .orderBy("payroll_processing.month", "desc");

    console.log("Records from DB:", records);
    console.log("User ID:", req.user.id);
    console.log("Company ID:", companyId);
    console.log("Query result count:", records.length);

    const transformedRecords = records.map((record) => {
      const dayTotals = normalizePayrollDayTotals({
        totalDays: record.total_days,
        payableDays: record.payable_days,
        lopDays: record.lop_days,
      });

      return {
        id: record.id.toString(),
        employeeId: record.employee_id.toString(),
        employeeCode: record.employee_code || null,
        employeeName:
          `${record.first_name || ""} ${record.last_name || ""}`.trim(),
        month: record.month,
        payableDays: dayTotals.payableDays,
        lopDays: dayTotals.lopDays,
        unpayableDays: dayTotals.lopDays,
        lopAmount: parseFloat(record.lop_amount) || 0,
        gross: parseFloat(record.gross) || 0,
        tdsAmount: parseFloat(record.tds_amount) || 0,
        tds_amount: parseFloat(record.tds_amount) || 0,
        deductions: parseFloat(record.deductions) || 0,
        net: parseFloat(record.net) || 0,
        status: record.status || "draft",
        createdAt: record.created_at || new Date().toISOString(),
      };
    });

    res.json({
      success: true,
      payrolls: transformedRecords,
    });
  } catch (error) {
    console.error("Get employee payslips error:", error);
    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

module.exports = {
  saveSalaryStructure,
  getSalaryStructures,
  processPayroll,
  updatePayrollStatus,
  getPayrollRecords,
  payslipPreview,
  getEmployeePayslips,
  updateSalaryStructure,
  deleteSalaryStructure,
  deletePayrollProcessing,
  deletePayslip,
};
