const knex = require('../db/db');
const {
  attachClientAssignments,
  applyEmployeeAssignmentFilter,
  normalizeEmployeeIds,
  syncClientAssignments,
} = require('../utils/clientAssignments');

const getValidatedEmployeeIds = async (companyId, employeeIds) => {
  const normalizedEmployeeIds = normalizeEmployeeIds(employeeIds);
  if (!normalizedEmployeeIds.length) {
    return [];
  }

  const rows = await knex('employees')
    .where('company_id', companyId)
    .whereIn('id', normalizedEmployeeIds)
    .select('id');

  return rows.map((row) => row.id);
};

const getClients = async (req, res) => {
  try {
    const companyId = req.user.company_id;
    const userType = req.user.type;
    const employeeId = req.user.id;

    let query = knex('clients')
      .leftJoin('employees', 'clients.assigned_to', 'employees.id')
      .select(
        'clients.*',
        'employees.first_name',
        'employees.last_name',
        'employees.employee_id'
      )
      .where('clients.company_id', companyId);

    if (userType === 'employee') {
      await applyEmployeeAssignmentFilter(query, {
        clientTable: 'clients',
        employeeId,
      });
    }

    const clients = await query.orderBy('clients.created_at', 'desc');
    const enrichedClients = await attachClientAssignments(clients);

    return res.json({
      success: true,
      data: enrichedClients,
    });
  } catch (error) {
    console.error('Error fetching clients:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch clients',
    });
  }
};

const createClient = async (req, res) => {
  try {
    const companyId = req.user.company_id;
    const {
      client_name,
      contact_person,
      email,
      phone,
      industry,
      address,
      status = 'active',
      assigned_to,
      assigned_employee_ids,
      geo_latitude,
      geo_longitude,
      geo_radius,
    } = req.body;

    if (!client_name) {
      return res.status(400).json({
        success: false,
        error: 'Client name is required',
      });
    }

    const lastClient = await knex('clients')
      .where({ company_id: companyId })
      .orderBy('id', 'desc')
      .first();

    let nextNumber = 1;
    if (lastClient?.client_id) {
      const match = String(lastClient.client_id).match(/CL(\d+)/);
      if (match) {
        nextNumber = parseInt(match[1], 10) + 1;
      }
    }

    const clientId = `CL${nextNumber.toString().padStart(3, '0')}`;
    const normalizedEmployeeIds = await getValidatedEmployeeIds(
      companyId,
      assigned_employee_ids !== undefined ? assigned_employee_ids : assigned_to
    );

    const newClientId = await knex.transaction(async (trx) => {
      const insertResult = await trx('clients').insert({
        client_id: clientId,
        client_name,
        contact_person,
        email,
        phone,
        industry,
        address,
        status,
        assigned_to: normalizedEmployeeIds[0] || null,
        geo_latitude: geo_latitude || null,
        geo_longitude: geo_longitude || null,
        geo_radius: geo_radius || 50,
        company_id: companyId,
      });

      const insertedId = Array.isArray(insertResult) ? insertResult[0] : insertResult;

      await syncClientAssignments({
        trx,
        clientId: insertedId,
        employeeIds: normalizedEmployeeIds,
      });

      return insertedId;
    });

    const newClient = await knex('clients')
      .leftJoin('employees', 'clients.assigned_to', 'employees.id')
      .select(
        'clients.*',
        'employees.first_name',
        'employees.last_name',
        'employees.employee_id'
      )
      .where('clients.id', newClientId)
      .first();

    const [enrichedClient] = await attachClientAssignments([newClient]);

    return res.status(201).json({
      success: true,
      message: 'Client created successfully',
      data: enrichedClient,
    });
  } catch (error) {
    console.error('Error creating client:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to create client',
    });
  }
};

const updateClient = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user.company_id;
    const {
      client_name,
      contact_person,
      email,
      phone,
      industry,
      address,
      status,
      assigned_to,
      assigned_employee_ids,
      geo_latitude,
      geo_longitude,
      geo_radius,
    } = req.body;

    const existingClient = await knex('clients')
      .where({ id, company_id: companyId })
      .first();

    if (!existingClient) {
      return res.status(404).json({
        success: false,
        error: 'Client not found',
      });
    }

    const hasAssignmentPayload =
      assigned_employee_ids !== undefined || assigned_to !== undefined;
    const normalizedEmployeeIds = await getValidatedEmployeeIds(
      companyId,
      assigned_employee_ids !== undefined ? assigned_employee_ids : assigned_to
    );

    const updateData = {
      client_name,
      contact_person,
      email,
      phone,
      industry,
      address,
      status,
      assigned_to: hasAssignmentPayload ? (normalizedEmployeeIds[0] || null) : undefined,
      geo_latitude: geo_latitude || null,
      geo_longitude: geo_longitude || null,
      geo_radius: geo_radius || 50,
    };

    Object.keys(updateData).forEach((key) => {
      if (updateData[key] === undefined) {
        delete updateData[key];
      }
    });

    await knex.transaction(async (trx) => {
      await trx('clients').where({ id }).update(updateData);

      if (hasAssignmentPayload) {
        await syncClientAssignments({
          trx,
          clientId: Number(id),
          employeeIds: normalizedEmployeeIds,
        });
      }
    });

    const updatedClient = await knex('clients')
      .leftJoin('employees', 'clients.assigned_to', 'employees.id')
      .select(
        'clients.*',
        'employees.first_name',
        'employees.last_name',
        'employees.employee_id'
      )
      .where('clients.id', id)
      .first();

    const [enrichedClient] = await attachClientAssignments([updatedClient]);

    return res.json({
      success: true,
      message: 'Client updated successfully',
      data: enrichedClient,
    });
  } catch (error) {
    console.error('Error updating client:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to update client',
    });
  }
};

const deleteClient = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user.company_id;

    const existingClient = await knex('clients')
      .where({ id, company_id: companyId })
      .first();

    if (!existingClient) {
      return res.status(404).json({
        success: false,
        error: 'Client not found',
      });
    }

    await knex('clients').where({ id }).del();

    return res.json({
      success: true,
      message: 'Client deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting client:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to delete client',
    });
  }
};

const getEmployeesForAssignment = async (req, res) => {
  try {
    const companyId = req.user.company_id;

    const employees = await knex('employees')
      .select(
        'id',
        'first_name',
        'last_name',
        'employee_id',
        'email'
      )
      .where('company_id', companyId)
      .whereRaw('LOWER(TRIM(COALESCE(status, ""))) = ?', ['active'])
      .orderBy('first_name');

    return res.json({
      success: true,
      data: employees,
    });
  } catch (error) {
    console.error('Error fetching employees:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch employees',
    });
  }
};

module.exports = {
  getClients,
  createClient,
  updateClient,
  deleteClient,
  getEmployeesForAssignment,
};
