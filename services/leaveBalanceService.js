const knex = require('../db/db');
let hasTotalColumnCache = null;

const normalize = (value) => String(value || '').trim().toLowerCase();
const compact = (value) => normalize(value).replace(/[\s_-]+/g, '');
const normalizeLeaveName = (value) =>
  compact(value).replace(/leave$/i, '');

const isEmployeeActive = (status) => normalize(status) === 'active';
const isEmployeeFullTime = (employmentType) => compact(employmentType) === 'fulltime';

const normalizeGender = (value) => compact(value);

const isLeaveTypeEligibleForEmployee = (leaveType, employee) => {
  if (!leaveType || !employee) return false;

  const leaveName = normalizeLeaveName(leaveType.name || leaveType.leave_type_name);
  const gender = normalizeGender(employee.gender);

  // Keep common legacy spelling variants covered so an old "mantory leave"
  // configuration cannot be allocated to male employees.
  if (
    leaveName.includes('maternity') ||
    leaveName.includes('maternal') ||
    leaveName.includes('mantory') ||
    leaveName.includes('menstrual')
  ) {
    return ['female', 'f', 'woman'].includes(gender);
  }

  if (leaveName.includes('paternity')) {
    return ['male', 'm', 'man'].includes(gender);
  }

  return true;
};

const hasRequiredAttendanceForLeaveType = async ({
  db,
  companyId,
  employee,
  leaveType,
  asOfDate = new Date()
}) => {
  const { getCompanyPolicy } = require('./companyPolicyService');
  const policy = await getCompanyPolicy(companyId);
  const leaveName = normalizeLeaveName(leaveType?.name);
  const casualLeaveNames = (policy.leave.casualLeaveNames || [])
    .map(normalizeLeaveName);

  if (
    policy.leave.casualLeaveAccrual !== 'after_attendance_days' ||
    !casualLeaveNames.includes(leaveName)
  ) {
    return true;
  }

  const requiredDays = Math.max(
    1,
    Number(policy.leave.casualLeaveMinimumAttendanceDays || 30)
  );
  const startDate = formatDateOnly(
    employee.doj || employee.date_of_joining || employee.created_at
  );
  const endDate = formatDateOnly(asOfDate);
  if (!startDate || !endDate) return false;

  const attendanceRows = await db('attendance')
    .where({ company_id: companyId, employee_id: employee.id })
    .where('check_in', '>=', `${startDate} 00:00:00`)
    .where('check_in', '<=', `${endDate} 23:59:59`)
    .select('check_in', 'status');

  const dayWeights = new Map();
  for (const row of attendanceRows) {
    const date = formatDateOnly(row.check_in);
    const status = normalize(row.status);
    if (!date) continue;
    const weight = ['present', 'grace', 'late'].includes(status)
      ? 1
      : ['half', 'half_day', 'half-day'].includes(status)
        ? 0.5
        : 0;
    dayWeights.set(date, Math.max(dayWeights.get(date) || 0, weight));
  }

  const attendedDays = [...dayWeights.values()].reduce(
    (total, weight) => total + weight,
    0
  );
  return attendedDays >= requiredDays;
};

const getActiveLeaveTypes = async (db, companyId, specificLeaveTypeId = null) => {
  const query = db('leave_types')
    .where({ company_id: companyId, status: 'active' })
    .select('id', 'name', 'annual_limit', 'is_paid', 'status');

  if (specificLeaveTypeId) {
    query.andWhere({ id: specificLeaveTypeId });
  }

  return query;
};

const hasLeaveBalanceTotalColumn = async (db) => {
  if (hasTotalColumnCache === null) {
    hasTotalColumnCache = await db.schema.hasColumn('leave_balances', 'total');
  }
  return hasTotalColumnCache;
};

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const getLeaveYearBounds = (year) => ({
  start: `${year}-01-01`,
  end: `${year}-12-31`
});

const formatDateOnly = (value) => {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const addYears = (date, years) => {
  const next = new Date(date);
  next.setFullYear(next.getFullYear() + years);
  return next;
};

const getFallbackCycleForDate = (dateValue = new Date()) => {
  const date = new Date(dateValue);
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  const year = safeDate.getFullYear();
  return {
    year,
    start: `${year}-01-01`,
    end: `${year}-12-31`,
    source: 'calendar'
  };
};

const getLeaveCycleForDate = async (db, companyId, dateValue = new Date()) => {
  const fallback = getFallbackCycleForDate(dateValue);
  if (!companyId || !(await db.schema.hasTable('fiscal_year'))) {
    return fallback;
  }

  const targetDate = formatDateOnly(dateValue) || formatDateOnly(new Date());
  const containing = await db('fiscal_year')
    .where({ company_id: companyId })
    .where('start_date', '<=', targetDate)
    .where('end_date', '>=', targetDate)
    .orderBy('is_active', 'desc')
    .first();

  const row =
    containing ||
    (await db('fiscal_year')
      .where({ company_id: companyId, is_active: 1 })
      .orderBy('start_date', 'desc')
      .first());

  if (!row?.start_date || !row?.end_date) return fallback;

  let cycleStart = new Date(row.leave_cycle_start || row.start_date);
  const target = new Date(targetDate);
  if (Number.isNaN(cycleStart.getTime()) || Number.isNaN(target.getTime())) {
    return fallback;
  }

  while (cycleStart > target) {
    cycleStart = addYears(cycleStart, -1);
  }

  const cycleEnd = addYears(cycleStart, 1);
  cycleEnd.setDate(cycleEnd.getDate() - 1);

  return {
    year: cycleStart.getFullYear(),
    start: formatDateOnly(cycleStart),
    end: formatDateOnly(cycleEnd),
    source: 'fiscal_year',
    fiscalYearId: row.id
  };
};

const getApprovedOverrideLeaveUsage = async ({
  db,
  companyId,
  employeeId,
  leaveTypeName,
  start,
  end
}) => {
  const targetName = normalizeLeaveName(leaveTypeName);
  if (!targetName) return 0;

  const rows = await db('attendance_overrides as ao')
    .leftJoin('attendance as a', 'ao.attendance_id', 'a.id')
    .where('ao.company_id', companyId)
    .where('ao.employee_id', employeeId)
    .whereRaw('LOWER(ao.status) = ?', ['approved'])
    .whereNotNull('ao.reason')
    .where((builder) => {
      builder
        .where('a.check_in', '>=', start)
        .where('a.check_in', '<=', `${end} 23:59:59`)
        .orWhere((fallback) => {
          fallback
            .whereNull('a.check_in')
            .where('ao.created_at', '>=', start)
            .where('ao.created_at', '<=', `${end} 23:59:59`);
        });
    })
    .select('ao.reason');

  return rows.reduce((total, row) => {
    const match = String(row.reason || '').match(
      /^\[(Paid Leave|Half Day Leave)\s+-\s+([^\]]+)\]/i
    );

    if (!match) return total;

    const overrideLeaveType = normalizeLeaveName(match[2]);
    if (overrideLeaveType !== targetName) return total;

    return total + (/half/i.test(match[1]) ? 0.5 : 1);
  }, 0);
};

const createMissingLeaveBalances = async ({
  db,
  companyId,
  employeeId,
  leaveTypes,
  year
}) => {
  let inserted = 0;

  for (const leaveType of leaveTypes) {
    const existing = await db('leave_balances')
      .where({
        company_id: companyId,
        employee_id: employeeId,
        leave_type_id: leaveType.id,
        year
      })
      .first();

    if (existing) continue;

    const annualLimit = Number(leaveType.annual_limit || 0);
    const insertData = {
      company_id: companyId,
      employee_id: employeeId,
      leave_type_id: leaveType.id,
      opening_balance: annualLimit,
      availed: 0,
      available: annualLimit,
      year
    };

    if (await hasLeaveBalanceTotalColumn(db)) {
      insertData.total = annualLimit;
    }

    await db('leave_balances').insert(insertData);

    inserted += 1;
  }

  return inserted;
};

const assignLeaveBalancesForEmployee = async (
  employeeId,
  companyId,
  options = {}
) => {
  const db = options.trx || knex;
  const cycle =
    options.cycle ||
    (await getLeaveCycleForDate(db, companyId, options.asOfDate || new Date()));
  const year = options.year || cycle.year;
  const specificLeaveTypeId = options.leaveTypeId || null;
  const requireActive = options.requireActive === true;

  const employee = await db('employees')
    .where({ id: employeeId, company_id: companyId })
    .select('id', 'status', 'employment_type', 'gender', 'doj', 'created_at')
    .first();

  if (!employee) {
    return { success: false, inserted: 0, reason: 'employee_not_found' };
  }

  if (!isEmployeeFullTime(employee.employment_type)) {
    return { success: true, inserted: 0, reason: 'employee_not_eligible' };
  }
  if (requireActive && !isEmployeeActive(employee.status)) {
    return { success: true, inserted: 0, reason: 'employee_not_eligible' };
  }

  const leaveTypes = [];
  for (const leaveType of await getActiveLeaveTypes(db, companyId, specificLeaveTypeId)) {
    if (
      isLeaveTypeEligibleForEmployee(leaveType, employee) &&
      await hasRequiredAttendanceForLeaveType({
        db,
        companyId,
        employee,
        leaveType,
        asOfDate: options.asOfDate || new Date()
      })
    ) {
      leaveTypes.push(leaveType);
    }
  }
  if (!leaveTypes.length) {
    return { success: true, inserted: 0, reason: 'no_active_leave_types' };
  }

  const inserted = await createMissingLeaveBalances({
    db,
    companyId,
    employeeId,
    leaveTypes,
    year
  });

  return {
    success: true,
    inserted,
    reason: inserted ? 'balances_created' : 'already_exists'
  };
};

const backfillLeaveBalancesForLeaveType = async (
  companyId,
  leaveTypeId,
  options = {}
) => {
  const db = options.trx || knex;
  const cycle =
    options.cycle ||
    (await getLeaveCycleForDate(db, companyId, options.asOfDate || new Date()));
  const year = options.year || cycle.year;

  const leaveTypes = await getActiveLeaveTypes(db, companyId, leaveTypeId);
  if (!leaveTypes.length) {
    return { success: true, employeesProcessed: 0, inserted: 0, reason: 'leave_type_not_active' };
  }

  const employees = await db('employees')
    .where({ company_id: companyId })
    .select('id', 'status', 'employment_type', 'gender', 'doj', 'created_at');

  const eligibleEmployees = employees.filter(
    (employee) =>
      isEmployeeActive(employee.status) &&
      isEmployeeFullTime(employee.employment_type) &&
      leaveTypes.some((leaveType) =>
        isLeaveTypeEligibleForEmployee(leaveType, employee),
      ),
  );

  if (!eligibleEmployees.length) {
    return { success: true, employeesProcessed: 0, inserted: 0, reason: 'no_eligible_employees' };
  }

  let inserted = 0;
  for (const employee of eligibleEmployees) {
    const eligibleLeaveTypes = [];
    for (const leaveType of leaveTypes) {
      if (
        isLeaveTypeEligibleForEmployee(leaveType, employee) &&
        await hasRequiredAttendanceForLeaveType({
          db, companyId, employee, leaveType, asOfDate: options.asOfDate || new Date()
        })
      ) eligibleLeaveTypes.push(leaveType);
    }
    inserted += await createMissingLeaveBalances({
      db,
      companyId,
      employeeId: employee.id,
      leaveTypes: eligibleLeaveTypes,
      year
    });
  }

  return {
    success: true,
    employeesProcessed: eligibleEmployees.length,
    inserted
  };
};

const reconcileMissingLeaveBalances = async (options = {}) => {
  const db = options.trx || knex;
  const companyId = options.companyId || null;

  const companyIds = companyId
    ? [Number(companyId)]
    : (await db('companies').select('id')).map((c) => c.id);

  let inserted = 0;
  let updated = 0;
  let employeesProcessed = 0;
  let companiesProcessed = 0;
  let resolvedYear = null;

  for (const cid of companyIds) {
    const cycle =
      options.cycle ||
      (await getLeaveCycleForDate(db, cid, options.asOfDate || new Date()));
    const year = options.year || cycle.year;
    resolvedYear = year;
    const leaveTypes = await getActiveLeaveTypes(db, cid);
    if (!leaveTypes.length) {
      companiesProcessed += 1;
      continue;
    }

    const employees = await db('employees')
      .where({ company_id: cid })
      .select('id', 'status', 'employment_type', 'gender', 'doj', 'created_at');

    const eligibleEmployees = employees.filter(
      (employee) =>
        isEmployeeActive(employee.status) &&
        isEmployeeFullTime(employee.employment_type),
    );

    employeesProcessed += eligibleEmployees.length;
    for (const employee of eligibleEmployees) {
      const eligibleLeaveTypes = [];
      for (const leaveType of leaveTypes) {
        if (
          isLeaveTypeEligibleForEmployee(leaveType, employee) &&
          await hasRequiredAttendanceForLeaveType({
            db, companyId: cid, employee, leaveType,
            asOfDate: options.asOfDate || new Date()
          })
        ) eligibleLeaveTypes.push(leaveType);
      }
      inserted += await createMissingLeaveBalances({
        db,
        companyId: cid,
        employeeId: employee.id,
        leaveTypes: eligibleLeaveTypes,
        year
      });
    }

    const { start, end } = cycle || getLeaveYearBounds(year);
    const hasTotalColumn = await hasLeaveBalanceTotalColumn(db);
    const balanceColumns = [
      'lb.id',
      'lb.employee_id',
        'lb.leave_type_id',
        'lb.opening_balance',
        'lb.availed',
        'lb.available',
        'lt.name as leave_type_name'
      ];

    if (hasTotalColumn) {
      balanceColumns.push('lb.total');
    }

    const balances = await db('leave_balances as lb')
      .join('leave_types as lt', 'lb.leave_type_id', 'lt.id')
      .where('lb.company_id', cid)
      .where('lb.year', year)
      .where((builder) => {
        builder
          .where('lt.is_paid', true)
          .orWhere('lt.is_paid', 1)
          .orWhere('lt.is_paid', '1');
      })
      .select(...balanceColumns);

    for (const balance of balances) {
      const usedRow = await db('leave_applications')
        .where({
          company_id: cid,
          employee_id: balance.employee_id,
          leave_type_id: balance.leave_type_id,
          status: 'approved'
        })
        .where('from_date', '>=', start)
        .where('from_date', '<=', end)
        .sum({ used: 'days' })
        .first();

      const total = toNumber(balance.total ?? balance.opening_balance);
      const overrideUsed = await getApprovedOverrideLeaveUsage({
        db,
        companyId: cid,
        employeeId: balance.employee_id,
        leaveTypeName: balance.leave_type_name,
        start,
        end
      });
      const availed = toNumber(usedRow?.used) + overrideUsed;
      const available = Math.max(total - availed, 0);

      if (
        toNumber(balance.availed) !== availed ||
        toNumber(balance.available) !== available
      ) {
        await db('leave_balances')
          .where({ id: balance.id })
          .update({ availed, available });
        updated += 1;
      }
    }

    companiesProcessed += 1;
  }

  return {
    success: true,
    year: resolvedYear || new Date().getFullYear(),
    companyId: companyId ? Number(companyId) : null,
    companiesProcessed,
    employeesProcessed,
    inserted,
    updated
  };
};

module.exports = {
  assignLeaveBalancesForEmployee,
  backfillLeaveBalancesForLeaveType,
  reconcileMissingLeaveBalances,
  getLeaveCycleForDate,
  isEmployeeFullTime,
  isEmployeeActive,
  isLeaveTypeEligibleForEmployee
};
