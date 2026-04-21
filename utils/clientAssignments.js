const knex = require('../db/db');

let clientAssignmentsTableExistsPromise = null;

const hasClientAssignmentsTable = async () => {
  if (!clientAssignmentsTableExistsPromise) {
    clientAssignmentsTableExistsPromise = knex.schema
      .hasTable('client_assignments')
      .catch((error) => {
        clientAssignmentsTableExistsPromise = null;
        throw error;
      });
  }

  return clientAssignmentsTableExistsPromise;
};

const normalizeEmployeeIds = (input) => {
  const rawValues = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? input.split(',')
      : input === null || input === undefined
        ? []
        : [input];

  return [...new Set(
    rawValues
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0)
  )];
};

const applyEmployeeAssignmentFilter = async (
  query,
  { clientTable = 'clients', employeeId }
) => {
  const hasAssignmentsTable = await hasClientAssignmentsTable();

  query.where((builder) => {
    builder.where(`${clientTable}.assigned_to`, employeeId);

    if (hasAssignmentsTable) {
      builder.orWhereExists(
        knex('client_assignments')
          .select(1)
          .whereRaw(`client_assignments.client_id = ${clientTable}.id`)
          .andWhere('client_assignments.employee_id', employeeId)
      );
    }
  });
};

const getAssignedClientCountForEmployee = async ({ companyId, employeeId }) => {
  const query = knex('clients').where('clients.company_id', companyId);
  await applyEmployeeAssignmentFilter(query, {
    clientTable: 'clients',
    employeeId,
  });

  const rows = await query.distinct('clients.id').pluck('clients.id');
  return rows.length;
};

const isClientAssignedToEmployee = async ({ clientId, companyId, employeeId }) => {
  const query = knex('clients')
    .where({
      'clients.id': clientId,
      'clients.company_id': companyId,
    });

  await applyEmployeeAssignmentFilter(query, {
    clientTable: 'clients',
    employeeId,
  });

  const row = await query.first('clients.id');
  return Boolean(row);
};

const getClientAssignmentsMap = async (clientIds) => {
  const assignmentMap = new Map();
  const normalizedClientIds = [...new Set(
    (clientIds || []).map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0)
  )];

  normalizedClientIds.forEach((clientId) => assignmentMap.set(clientId, []));

  if (!normalizedClientIds.length) {
    return assignmentMap;
  }

  const hasAssignmentsTable = await hasClientAssignmentsTable();
  if (!hasAssignmentsTable) {
    return assignmentMap;
  }

  const rows = await knex('client_assignments as ca')
    .join('employees as e', 'ca.employee_id', 'e.id')
    .select(
      'ca.client_id',
      'e.id',
      'e.first_name',
      'e.last_name',
      'e.employee_id',
      'e.email'
    )
    .whereIn('ca.client_id', normalizedClientIds)
    .orderBy('e.first_name', 'asc');

  for (const row of rows) {
    const current = assignmentMap.get(row.client_id) || [];
    current.push({
      id: row.id,
      first_name: row.first_name,
      last_name: row.last_name,
      employee_id: row.employee_id,
      email: row.email,
    });
    assignmentMap.set(row.client_id, current);
  }

  return assignmentMap;
};

const attachClientAssignments = async (clients) => {
  if (!Array.isArray(clients) || !clients.length) {
    return [];
  }

  const assignmentMap = await getClientAssignmentsMap(clients.map((client) => client.id));

  return clients.map((client) => {
    const assignedEmployees = assignmentMap.get(client.id) || [];

    // Backward compatibility: if the new table is empty, keep old single assignment visible.
    if (!assignedEmployees.length && client.assigned_to) {
      return {
        ...client,
        assigned_employee_ids: [client.assigned_to],
        assigned_employees: client.first_name
          ? [{
            id: client.assigned_to,
            first_name: client.first_name,
            last_name: client.last_name,
            employee_id: client.employee_id,
            email: undefined,
          }]
          : [],
      };
    }

    return {
      ...client,
      assigned_employee_ids: assignedEmployees.map((employee) => employee.id),
      assigned_employees: assignedEmployees,
    };
  });
};

const syncClientAssignments = async ({
  trx = knex,
  clientId,
  employeeIds,
}) => {
  const hasAssignmentsTable = await hasClientAssignmentsTable();
  if (!hasAssignmentsTable) {
    return;
  }

  const normalizedIds = normalizeEmployeeIds(employeeIds);

  await trx('client_assignments').where({ client_id: clientId }).del();

  if (!normalizedIds.length) {
    return;
  }

  await trx('client_assignments').insert(
    normalizedIds.map((employeeId) => ({
      client_id: clientId,
      employee_id: employeeId,
    }))
  );
};

module.exports = {
  attachClientAssignments,
  applyEmployeeAssignmentFilter,
  getAssignedClientCountForEmployee,
  hasClientAssignmentsTable,
  isClientAssignedToEmployee,
  normalizeEmployeeIds,
  syncClientAssignments,
};
