const assert = require('node:assert/strict');
const { test } = require('node:test');
const { findActiveAttendance } = require('./attendanceSession');

// Small read-only query fixture: exercises the real session lookup against
// historical punches without touching employee attendance in the database.
function database(records) {
  return (table) => {
    assert.equal(table, 'attendance');
    const filters = [];
    const ordering = [];
    const query = {
      where(field, operator, value) {
        if (typeof field === 'object') filters.push(row => Object.entries(field).every(([key, expected]) => row[key] === expected));
        else {
          assert.equal(operator, '<=');
          filters.push(row => new Date(row[field]) <= new Date(value));
        }
        return query;
      },
      orderBy(field, direction) { ordering.push([field, direction]); return query; },
      async first() {
        return records.filter(row => filters.every(filter => filter(row))).sort((a, b) => {
          for (const [field, direction] of ordering) {
            const difference = field === 'check_in' ? new Date(a[field]) - new Date(b[field]) : a[field] - b[field];
            if (difference) return direction === 'desc' ? -difference : difference;
          }
          return 0;
        })[0];
      },
    };
    return query;
  };
}

const punch = (id, check_in, check_out = null, extra = {}) => ({ id, company_id: 51, employee_id: 99, check_in, check_out, ...extra });
const morning = { companyId: 51, employeeId: 99, at: new Date('2026-09-16T09:00:00+05:30') };

test('10:30 pm checkout means check-in is available the next morning', async () => {
  const rows = [punch(1, '2026-09-15T09:00:00+05:30', '2026-09-15T22:30:00+05:30')];
  assert.equal(await findActiveAttendance(database(rows), morning), null);
});

test('old incomplete punches do not reopen a later completed session', async () => {
  const rows = [punch(1, '2026-09-15T08:59:59+05:30'), punch(2, '2026-09-15T09:00:00+05:30', '2026-09-15T22:30:00+05:30')];
  assert.equal(await findActiveAttendance(database(rows), morning), null);
});

test('without a manual checkout the latest session stays open overnight', async () => {
  const row = punch(1, '2026-09-15T22:00:00+05:30');
  assert.equal(await findActiveAttendance(database([row]), morning), row);
});

test('a session does not expire after 36 hours or at midnight', async () => {
  const row = punch(1, '2026-09-12T09:00:00+05:30');
  assert.equal(await findActiveAttendance(database([row]), morning), row);
});

test('multiple daily sessions follow the most recent punch', async () => {
  const rows = [punch(1, '2026-09-15T09:00:00+05:30', '2026-09-15T13:00:00+05:30'), punch(2, '2026-09-15T14:00:00+05:30')];
  assert.equal((await findActiveAttendance(database(rows), morning)).id, 2);
  rows[1].check_out = '2026-09-15T22:30:00+05:30';
  assert.equal(await findActiveAttendance(database(rows), morning), null);
});

test('uses id to resolve equal timestamps and isolates employee/company', async () => {
  const time = '2026-09-15T09:00:00+05:30';
  const rows = [punch(1, time), punch(2, time, '2026-09-15T22:30:00+05:30'), punch(3, time, null, { employee_id: 100 }), punch(4, time, null, { company_id: 52 })];
  assert.equal(await findActiveAttendance(database(rows), morning), null);
});

test('no records or future punches do not create an active session', async () => {
  assert.equal(await findActiveAttendance(database([]), morning), null);
  assert.equal(await findActiveAttendance(database([punch(1, '2026-09-17T09:00:00+05:30')]), morning), null);
});
