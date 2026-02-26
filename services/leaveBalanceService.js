const knex = require('../db/db');
let hasTotalColumnCache = null;

const normalize = (value) => String(value || '').trim().toLowerCase();
const compact = (value) => normalize(value).replace(/[\s_-]+/g, '');

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

    companiesProcessed += 1;
  }

  return {
    success: true,
    year,
    companyId: companyId ? Number(companyId) : null,
    companiesProcessed,
    employeesProcessed,
    inserted
  };
};

module.exports = {
  assignLeaveBalancesForEmployee,
  backfillLeaveBalancesForLeaveType,
  reconcileMissingLeaveBalances,
  isEmployeeFullTime,
  isEmployeeActive
};
