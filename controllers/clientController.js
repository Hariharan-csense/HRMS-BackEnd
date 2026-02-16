const knex = require('../db/db');
const { generateAutoNumber } = require('../utils/generateAutoNumber');

// Get all clients for a company
// const getClients = async (req, res) => {
//   try {
//     const companyId = req.user.company_id;
    
//     const clients = await knex('clients')
//       .leftJoin('employees', 'clients.assigned_to', 'employees.id')
//       .select(
//         'clients.*',
//         'employees.first_name',
//         'employees.last_name',
//         'employees.employee_id'
//       )
//       .where('clients.company_id', companyId)
//       .orderBy('clients.created_at', 'desc');

//     res.json({
//       success: true,
//       data: clients
//     });
//   } catch (error) {
//     console.error('Error fetching clients:', error);
//     res.status(500).json({
//       success: false,
//       error: 'Failed to fetch clients'
//     });
//   }
// };


const getClients = async (req, res) => {
  try {
    const companyId = req.user.company_id;
    const userRole = req.user.role;
    const userType = req.user.type;   // admin / employee
    const employeeId = req.user.id;   // employees.id

    console.log('REQ.USER:', req.user); // DEBUG

    let query = knex('clients')
      .leftJoin('employees', 'clients.assigned_to', 'employees.id')
      .select(
        'clients.*',
        'employees.first_name',
        'employees.last_name',
        'employees.employee_id'
      )
      .where('clients.company_id', companyId);

    // 👉 Only employee: show assigned clients
    if (userType === 'employee') {
      query = query.andWhere('clients.assigned_to', employeeId);
    }

    const clients = await query.orderBy('clients.created_at', 'desc');

    res.json({
      success: true,
      data: clients
    });

  } catch (error) {
    console.error('Error fetching clients:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch clients'
    });
  }
};



// Create new client
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
      geo_latitude,
      geo_longitude,
      geo_radius
    } = req.body;

    if (!client_name) {
      return res.status(400).json({
        success: false,
        error: 'Client name is required'
      });
    }

    // Generate client ID (CL001 format)
    const lastClient = await knex('clients')
      .where({ company_id: companyId })
      .orderBy('id', 'desc')
      .first();

    let nextNumber = 1;
    if (lastClient && lastClient.client_id) {
      const match = lastClient.client_id.match(/CL(\d+)/);
      if (match) {
        nextNumber = parseInt(match[1]) + 1;
      }
    }

    const clientId = `CL${nextNumber.toString().padStart(3, '0')}`;

    const [newClientId] = await knex('clients').insert({
      client_id: clientId,
      client_name,
      contact_person,
      email,
      phone,
      industry,
      address,
      status,
      assigned_to: assigned_to || null,
      geo_latitude: geo_latitude || null,
      geo_longitude: geo_longitude || null,
      geo_radius: geo_radius || 50,
      company_id: companyId
    });

    const newClient = await knex('clients').where('id', newClientId).first();

    res.status(201).json({
      success: true,
      message: 'Client created successfully',
      data: newClient
    });
  } catch (error) {
    console.error('Error creating client:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create client'
    });
  }
};

// Update client
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
      geo_latitude,
      geo_longitude,
      geo_radius
    } = req.body;

    // Check if client exists and belongs to the company
    const existingClient = await knex('clients')
      .where({ id, company_id: companyId })
      .first();

    if (!existingClient) {
      return res.status(404).json({
        success: false,
        error: 'Client not found'
      });
    }

    const updateData = {
      client_name,
      contact_person,
      email,
      phone,
      industry,
      address,
      status,
      assigned_to: assigned_to || null,
      geo_latitude: geo_latitude || null,
      geo_longitude: geo_longitude || null,
      geo_radius: geo_radius || 50
    };

    // Remove undefined values
    Object.keys(updateData).forEach(key => 
      updateData[key] === undefined && delete updateData[key]
    );

    await knex('clients')
      .where({ id })
      .update(updateData);

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

    res.json({
      success: true,
      message: 'Client updated successfully',
      data: updatedClient
    });
  } catch (error) {
    console.error('Error updating client:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update client'
    });
  }
};

// Delete client
const deleteClient = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user.company_id;

    // Check if client exists and belongs to the company
    const existingClient = await knex('clients')
      .where({ id, company_id: companyId })
      .first();

    if (!existingClient) {
      return res.status(404).json({
        success: false,
        error: 'Client not found'
      });
    }

    await knex('clients').where({ id }).del();

    res.json({
      success: true,
      message: 'Client deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting client:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete client'
    });
  }
};

// Get employees for assignment dropdown
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
      .where('status', 'active')
      .orderBy('first_name');

    res.json({
      success: true,
      data: employees
    });
  } catch (error) {
    console.error('Error fetching employees:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch employees'
    });
  }
};

module.exports = {
  getClients,
  createClient,
  updateClient,
  deleteClient,
  getEmployeesForAssignment
};
