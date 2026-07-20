const knex = require("../db/db");

const DEFAULT_POLICY = {
  leave: {
    casualLeaveEnabled: true,
    casualLeaveNames: ["casual leave", "cl", "casual"],
    casualLeavePerMonth: 1,
    casualLeaveAccrual: "monthly_start",
    includePendingLeaveInUsage: true,
  },
  permission: {
    enabled: true,
    maxPerMonth: 2,
    hoursPerPermission: 1,
    includePendingInUsage: true,
  },
  attendance: {
    gracePolicyEnabled: true,
    workStartTime: "09:30",
    workEndTime: "18:00",
    gracePeriodMinutes: 5,
    graceDaysPerMonth: 0,
    halfDayThresholdHours: 4,
  },
  expense: {
    enabled: true,
    monthlyOverallLimit: 0,
    categories: {
      food: { perClaimLimit: 0, monthlyLimit: 0 },
      travel: { perClaimLimit: 0, monthlyLimit: 0 },
      accommodation: { perClaimLimit: 0, monthlyLimit: 0 },
      miscellaneous: { perClaimLimit: 0, monthlyLimit: 0 },
    },
  },
};

const cloneDefaultPolicy = () => JSON.parse(JSON.stringify(DEFAULT_POLICY));

const safeJsonParse = (value, fallback) => {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const normalizeNumber = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
};

const normalizePolicy = (raw = {}) => {
  const defaults = cloneDefaultPolicy();
  const leave = { ...defaults.leave, ...(raw.leave || {}) };
  const permission = { ...defaults.permission, ...(raw.permission || {}) };
  const attendance = { ...defaults.attendance, ...(raw.attendance || {}) };
  const expenseRaw = { ...defaults.expense, ...(raw.expense || {}) };
  const categories = {
    ...defaults.expense.categories,
    ...(expenseRaw.categories || {}),
  };

  Object.keys(categories).forEach((key) => {
    categories[key] = {
      perClaimLimit: normalizeNumber(categories[key]?.perClaimLimit),
      monthlyLimit: normalizeNumber(categories[key]?.monthlyLimit),
    };
  });

  return {
    leave: {
      ...leave,
      casualLeaveNames: Array.isArray(leave.casualLeaveNames)
        ? leave.casualLeaveNames
        : defaults.leave.casualLeaveNames,
      casualLeavePerMonth: normalizeNumber(leave.casualLeavePerMonth, 1),
      casualLeaveAccrual:
        leave.casualLeaveAccrual === "after_full_month"
          ? "after_full_month"
          : "monthly_start",
      includePendingLeaveInUsage: leave.includePendingLeaveInUsage !== false,
    },
    permission: {
      ...permission,
      maxPerMonth: normalizeNumber(permission.maxPerMonth, 2),
      hoursPerPermission: normalizeNumber(permission.hoursPerPermission, 1) || 1,
      includePendingInUsage: permission.includePendingInUsage !== false,
    },
    attendance: {
      ...attendance,
      gracePolicyEnabled: attendance.gracePolicyEnabled !== false,
      workStartTime: attendance.workStartTime || defaults.attendance.workStartTime,
      workEndTime: attendance.workEndTime || defaults.attendance.workEndTime,
      gracePeriodMinutes: normalizeNumber(attendance.gracePeriodMinutes, 5),
      graceDaysPerMonth: normalizeNumber(attendance.graceDaysPerMonth, 0),
      halfDayThresholdHours: normalizeNumber(attendance.halfDayThresholdHours, 4) || 4,
    },
    expense: {
      ...expenseRaw,
      monthlyOverallLimit: normalizeNumber(expenseRaw.monthlyOverallLimit),
      categories,
    },
  };
};

const ensureCompanyPolicyTable = async () => {
  const exists = await knex.schema.hasTable("company_policies");
  if (exists) {
    const hasAttendancePolicy = await knex.schema.hasColumn(
      "company_policies",
      "attendance_policy",
    );
    if (!hasAttendancePolicy) {
      await knex.schema.alterTable("company_policies", (table) => {
        table.text("attendance_policy").nullable();
      });
    }
    return;
  }

  await knex.schema.createTable("company_policies", (table) => {
    table.increments("id").primary();
    table.integer("company_id").unsigned().notNullable().unique();
    table.text("leave_policy").nullable();
    table.text("permission_policy").nullable();
    table.text("attendance_policy").nullable();
    table.text("expense_policy").nullable();
    table.timestamps(true, true);
    table
      .foreign("company_id")
      .references("id")
      .inTable("companies")
      .onDelete("CASCADE");
  });
};

const getCompanyPolicy = async (companyId) => {
  await ensureCompanyPolicyTable();
  const row = await knex("company_policies").where({ company_id: companyId }).first();
  if (!row) return cloneDefaultPolicy();

  return normalizePolicy({
    leave: safeJsonParse(row.leave_policy, DEFAULT_POLICY.leave),
    permission: safeJsonParse(row.permission_policy, DEFAULT_POLICY.permission),
    attendance: safeJsonParse(row.attendance_policy, DEFAULT_POLICY.attendance),
    expense: safeJsonParse(row.expense_policy, DEFAULT_POLICY.expense),
  });
};

const saveCompanyPolicy = async (companyId, policy) => {
  await ensureCompanyPolicyTable();
  const normalized = normalizePolicy(policy);
  const payload = {
    company_id: companyId,
    leave_policy: JSON.stringify(normalized.leave),
    permission_policy: JSON.stringify(normalized.permission),
    attendance_policy: JSON.stringify(normalized.attendance),
    expense_policy: JSON.stringify(normalized.expense),
    updated_at: knex.fn.now(),
  };

  const existing = await knex("company_policies").where({ company_id: companyId }).first();
  if (existing) {
    await knex("company_policies").where({ company_id: companyId }).update(payload);
  } else {
    await knex("company_policies").insert({ ...payload, created_at: knex.fn.now() });
  }

  return normalized;
};

const normalizeText = (value) =>
  String(value || "")
    .toLowerCase()
    .trim();

const isCasualLeaveType = (leaveType, policy) => {
  const leaveName = normalizeText(leaveType?.name);
  return (policy.leave.casualLeaveNames || []).some(
    (name) => normalizeText(name) && leaveName === normalizeText(name),
  );
};

const monthStartEnd = (dateValue) => {
  const date = new Date(dateValue);
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
};

const fullMonthsBetween = (startValue, endValue) => {
  const start = new Date(startValue);
  const end = new Date(endValue);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
    return 0;
  }
  let months =
    (end.getFullYear() - start.getFullYear()) * 12 +
    (end.getMonth() - start.getMonth());
  if (end.getDate() < start.getDate()) months -= 1;
  return Math.max(0, months);
};

const earnedCasualLeave = (employee, asOfDate, policy) => {
  const monthly = normalizeNumber(policy.leave.casualLeavePerMonth, 1);
  if (monthly <= 0) return 0;

  const doj = employee?.doj || employee?.date_of_joining || employee?.dateOfJoining;
  const asOf = new Date(asOfDate);
  if (!doj || Number.isNaN(asOf.getTime())) return monthly;

  if (policy.leave.casualLeaveAccrual === "after_full_month") {
    return fullMonthsBetween(doj, asOfDate) * monthly;
  }

  const start = new Date(doj);
  const yearStart = new Date(asOf.getFullYear(), 0, 1);
  const accrualStart = start > yearStart ? start : yearStart;
  const months =
    (asOf.getFullYear() - accrualStart.getFullYear()) * 12 +
    (asOf.getMonth() - accrualStart.getMonth()) +
    1;
  return Math.max(0, months) * monthly;
};

const validateLeavePolicy = async ({
  companyId,
  employee,
  leaveType,
  requestedDays,
  fromDate,
}) => {
  const policy = await getCompanyPolicy(companyId);
  if (!policy.leave.casualLeaveEnabled || !isCasualLeaveType(leaveType, policy)) {
    return null;
  }

  const earned = earnedCasualLeave(employee, fromDate, policy);
  const statuses = policy.leave.includePendingLeaveInUsage
    ? ["pending", "approved"]
    : ["approved"];
  const year = new Date(fromDate).getFullYear();
  const usedRow = await knex("leave_applications")
    .where({
      company_id: companyId,
      employee_id: employee.id,
      leave_type_id: leaveType.id,
    })
    .whereIn("status", statuses)
    .whereRaw("YEAR(from_date) = ?", [year])
    .sum({ used: "days" })
    .first();

  const used = Number(usedRow?.used || 0);
  if (used + Number(requestedDays || 0) > earned) {
    return `As per company policy Casual Leave limit is ${earned} day(s).`;
  }

  return null;
};

const timeToMinutes = (value) => {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
};

const getPermissionUnits = (fromTime, toTime, hoursPerPermission) => {
  const fromMinutes = timeToMinutes(fromTime);
  const toMinutes = timeToMinutes(toTime);
  if (fromMinutes === null || toMinutes === null || toMinutes <= fromMinutes) {
    return 1;
  }

  const durationHours = (toMinutes - fromMinutes) / 60;
  return Math.max(1, Math.ceil(durationHours / hoursPerPermission));
};

const validatePermissionPolicy = async ({
  companyId,
  employeeId,
  permissionDate,
  permissionTimeFrom,
  permissionTimeTo,
}) => {
  const policy = await getCompanyPolicy(companyId);
  if (!policy.permission.enabled || !policy.permission.maxPerMonth) return null;

  const { start, end } = monthStartEnd(permissionDate);
  const statuses = policy.permission.includePendingInUsage
    ? ["pending", "approved"]
    : ["approved"];
  const existingPermissions = await knex("leave_permissions")
    .where({ company_id: companyId, employee_id: employeeId })
    .whereIn("status", statuses)
    .whereBetween("permission_date", [start, end])
    .select("permission_time_from", "permission_time_to");

  const hoursPerPermission = normalizeNumber(policy.permission.hoursPerPermission, 1) || 1;
  const usedUnits = existingPermissions.reduce(
    (total, permission) =>
      total +
      getPermissionUnits(
        permission.permission_time_from,
        permission.permission_time_to,
        hoursPerPermission,
      ),
    0,
  );
  const requestedUnits = getPermissionUnits(
    permissionTimeFrom,
    permissionTimeTo,
    hoursPerPermission,
  );

  if (usedUnits + requestedUnits > Number(policy.permission.maxPerMonth)) {
    return `As per company policy Permission limit is ${policy.permission.maxPerMonth} permission unit(s) per month.`;
  }

  return null;
};

const normalizeExpenseCategory = (category) => {
  const normalized = normalizeText(category).replace(/[^a-z]/g, "");
  if (normalized.includes("food") || normalized.includes("meal")) return "food";
  if (normalized.includes("travel") || normalized.includes("cab") || normalized.includes("taxi")) {
    return "travel";
  }
  if (normalized.includes("accommodation") || normalized.includes("hotel") || normalized.includes("stay")) {
    return "accommodation";
  }
  return "miscellaneous";
};

const formatPolicyCategoryLabel = (category) =>
  String(category || "")
    .replace(/_/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase()) || "Expense";

const expenseCategorySqlTerms = {
  food: ["food", "meal", "restaurant", "canteen"],
  travel: ["travel", "cab", "taxi", "uber", "ola"],
  accommodation: ["accommodation", "hotel", "stay", "lodging"],
  miscellaneous: ["misc", "other"],
};

const applyExpenseCategoryFilter = (query, categoryKey) => {
  const terms = expenseCategorySqlTerms[categoryKey] || [categoryKey];
  query.where((builder) => {
    terms.forEach((term) => {
      builder.orWhereRaw("LOWER(category) LIKE ?", [`%${term}%`]);
    });
  });
};

const applyExcludedExpenseFilter = (query, excludedExpenseIds = []) => {
  const ids = excludedExpenseIds.map((id) => String(id || "").trim()).filter(Boolean);
  if (ids.length) query.whereNotIn("expense_id", ids);
};

const validateExpensePolicy = async ({
  companyId,
  employeeId,
  expenseRows,
  excludedExpenseIds = [],
}) => {
  const policy = await getCompanyPolicy(companyId);
  if (!policy.expense.enabled) return null;

  const rows = Array.isArray(expenseRows) ? expenseRows : [expenseRows];
  const dailyGrouped = new Map();
  const monthlyGrouped = new Map();

  for (const row of rows) {
    const categoryKey = normalizeExpenseCategory(row.category);
    const amount = Number(row.amount || 0);
    const date = row.expense_date || row.date || new Date().toISOString().slice(0, 10);
    const categoryPolicy = policy.expense.categories[categoryKey];
    const categoryLabel = formatPolicyCategoryLabel(row.category || categoryKey);

    if (categoryPolicy?.perClaimLimit && amount > categoryPolicy.perClaimLimit) {
      return `As per company policy ${categoryLabel} claim limit is ${categoryPolicy.perClaimLimit}.`;
    }

    const dayKey = `${date}:${categoryKey}`;
    dailyGrouped.set(dayKey, {
      categoryKey,
      categoryLabel,
      date,
      amount: (dailyGrouped.get(dayKey)?.amount || 0) + amount,
    });

    const monthKey = `${date.slice(0, 7)}:${categoryKey}`;
    monthlyGrouped.set(monthKey, {
      categoryKey,
      date,
      amount: (monthlyGrouped.get(monthKey)?.amount || 0) + amount,
    });
  }

  for (const entry of dailyGrouped.values()) {
    const categoryPolicy = policy.expense.categories[entry.categoryKey];
    if (!categoryPolicy?.perClaimLimit) continue;

    if (entry.amount > categoryPolicy.perClaimLimit) {
      return `As per company policy ${entry.categoryLabel} claim limit is ${categoryPolicy.perClaimLimit}.`;
    }

    const existingByDay = await knex("expenses")
      .where({ company_id: companyId, employee_id: employeeId })
      .whereRaw("LOWER(status) <> ?", ["rejected"])
      .whereRaw("DATE(expense_date) = ?", [entry.date])
      .sum({ total: "amount" })
      .modify((query) => {
        applyExpenseCategoryFilter(query, entry.categoryKey);
        applyExcludedExpenseFilter(query, excludedExpenseIds);
      })
      .first();

    const totalForDay = Number(existingByDay?.total || 0) + entry.amount;
    if (totalForDay > categoryPolicy.perClaimLimit) {
      return `As per company policy ${entry.categoryLabel} claim limit is ${categoryPolicy.perClaimLimit}.`;
    }
  }

  for (const entry of monthlyGrouped.values()) {
    const categoryPolicy = policy.expense.categories[entry.categoryKey];
    if (!categoryPolicy?.monthlyLimit && !policy.expense.monthlyOverallLimit) continue;

    const { start, end } = monthStartEnd(entry.date);
    const existingByCategory = await knex("expenses")
      .where({ company_id: companyId, employee_id: employeeId })
      .whereRaw("LOWER(status) <> ?", ["rejected"])
      .whereBetween("expense_date", [start, end])
      .sum({ total: "amount" })
      .modify((query) => {
        if (categoryPolicy?.monthlyLimit) {
          applyExpenseCategoryFilter(query, entry.categoryKey);
        }
        applyExcludedExpenseFilter(query, excludedExpenseIds);
      })
      .first();

    if (
      categoryPolicy?.monthlyLimit &&
      Number(existingByCategory?.total || 0) + entry.amount > categoryPolicy.monthlyLimit
    ) {
      return `As per company policy ${formatPolicyCategoryLabel(entry.categoryKey)} monthly claim limit is ${categoryPolicy.monthlyLimit}.`;
    }
  }

  if (policy.expense.monthlyOverallLimit) {
    const byMonth = new Map();
    rows.forEach((row) => {
      const date = row.expense_date || row.date || new Date().toISOString().slice(0, 10);
      const key = date.slice(0, 7);
      byMonth.set(key, {
        date,
        amount: (byMonth.get(key)?.amount || 0) + Number(row.amount || 0),
      });
    });

    for (const entry of byMonth.values()) {
      const { start, end } = monthStartEnd(entry.date);
      const existing = await knex("expenses")
        .where({ company_id: companyId, employee_id: employeeId })
        .whereRaw("LOWER(status) <> ?", ["rejected"])
        .whereBetween("expense_date", [start, end])
        .sum({ total: "amount" })
        .modify((query) => {
          applyExcludedExpenseFilter(query, excludedExpenseIds);
        })
        .first();

      if (Number(existing?.total || 0) + entry.amount > policy.expense.monthlyOverallLimit) {
        return `As per company policy Monthly expense claim limit is ${policy.expense.monthlyOverallLimit}.`;
      }
    }
  }

  return null;
};

module.exports = {
  DEFAULT_POLICY,
  getCompanyPolicy,
  saveCompanyPolicy,
  validateLeavePolicy,
  validatePermissionPolicy,
  validateExpensePolicy,
};
