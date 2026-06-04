const knex = require('../db/db');
let hasTotalColumnCache = null;

const normalize = (value) => String(value || '').trim().toLowerCase();
const compact = (value) => normalize(value).replace(/[\s_-]+/g, '');
const normalizeLeaveName = (value) =>
  compact(value).replace(/leave$/i, '');

const isEmployeeActive = (status) => normalize(status) === 'active';
const isEmployeeFullTime = (employmentType) => compact(employmentType) === 'fulltime';

const getActiveLeaveTypes = async (db, companyId, specificLeaveTypeId = null) => {
  const query = db('leave_types')
    .where({ company_id: companyId, status: 'active' })
    .select('id', 'name', 'annual_limit');

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
  const year = options.year || new Date().getFullYear();
  const specificLeaveTypeId = options.leaveTypeId || null;
  const requireActive = options.requireActive === true;

  const employee = await db('employees')
    .where({ id: employeeId, company_id: companyId })
    .select('id', 'status', 'employment_type')
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

  const leaveTypes = await getActiveLeaveTypes(db, companyId, specificLeaveTypeId);
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
  const year = options.year || new Date().getFullYear();

  const leaveTypes = await getActiveLeaveTypes(db, companyId, leaveTypeId);
  if (!leaveTypes.length) {
    return { success: true, employeesProcessed: 0, inserted: 0, reason: 'leave_type_not_active' };
  }

  const employees = await db('employees')
    .where({ company_id: companyId })
    .select('id', 'status', 'employment_type');

  const eligibleEmployeeIds = employees
    .filter((e) => isEmployeeActive(e.status) && isEmployeeFullTime(e.employment_type))
    .map((e) => e.id);

  if (!eligibleEmployeeIds.length) {
    return { success: true, employeesProcessed: 0, inserted: 0, reason: 'no_eligible_employees' };
  }

  let inserted = 0;
  for (const employeeId of eligibleEmployeeIds) {
    inserted += await createMissingLeaveBalances({
      db,
      companyId,
      employeeId,
      leaveTypes,
      year
    });
  }

  return {
    success: true,
    employeesProcessed: eligibleEmployeeIds.length,
    inserted
  };
};

const reconcileMissingLeaveBalances = async (options = {}) => {
  const db = options.trx || knex;
  const year = options.year || new Date().getFullYear();
  const companyId = options.companyId || null;

  const companyIds = companyId
    ? [Number(companyId)]
    : (await db('companies').select('id')).map((c) => c.id);

  let inserted = 0;
  let updated = 0;
  let employeesProcessed = 0;
  let companiesProcessed = 0;

  for (const cid of companyIds) {
    const leaveTypes = await getActiveLeaveTypes(db, cid);
    if (!leaveTypes.length) {
      companiesProcessed += 1;
      continue;
    }

    const employees = await db('employees')
      .where({ company_id: cid })
      .select('id', 'status', 'employment_type');

    const eligibleEmployeeIds = employees
      .filter((e) => isEmployeeActive(e.status) && isEmployeeFullTime(e.employment_type))
      .map((e) => e.id);

    employeesProcessed += eligibleEmployeeIds.length;
    for (const employeeId of eligibleEmployeeIds) {
      inserted += await createMissingLeaveBalances({
        db,
        companyId: cid,
        employeeId,
        leaveTypes,
        year
      });
    }

    const { start, end } = getLeaveYearBounds(year);
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
    year,
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
  isEmployeeFullTime,
  isEmployeeActive
};
