const db = require('../db/db');
const { v4: uuidv4 } = require('uuid');

// Get all users
const getUsers = async (req, res) => {
  try {
    const { company_id, role } = req.user;
    
    let users = [];
    
    // Get users from users table
    let usersQuery = db('users')
      .select(
        'users.id',
        'users.name',
        'users.email',
        'users.role',
        'users.department',
        'users.avatar',
        'users.created_at',
        'users.updated_at',
        'companies.company_name as company_name',
        db.raw('NULL as employee_id'),
        db.raw('NULL as first_name'),
        db.raw('NULL as last_name'),
        db.raw('NULL as status'),
        db.raw('NULL as department_id'),
        db.raw('NULL as designation_id'),
        db.raw('NULL as profile_photo'),
        db.raw('"users" as source_table')
      )
      .leftJoin('companies', 'users.company_id', 'companies.id');
    
    // Get employees from employees table
    let employeesQuery = db('employees')
      .select(
        'employees.id',
        db.raw('CONCAT(employees.first_name, " ", employees.last_name) as name'),
        'employees.email',
        'employees.role',
        db.raw('NULL as department'),
        db.raw('NULL as avatar'),
        'employees.created_at',
        'employees.updated_at',
        'companies.company_name as company_name',
        'employees.employee_id',
        'employees.first_name',
        'employees.last_name',
        'employees.status',
        'employees.department_id',
        'employees.designation_id',
        db.raw('(SELECT file_path FROM employee_documents WHERE employee_id = employees.id AND fieldname = "photo" LIMIT 1) as profile_photo'),
        db.raw('"employees" as source_table')
      )
      .leftJoin('companies', 'employees.company_id', 'companies.id');
    
    // If not superadmin, filter by company_id
    if (role !== 'superadmin') {
      usersQuery = usersQuery.where('users.company_id', company_id);
      employeesQuery = employeesQuery.where('employees.company_id', company_id);
    }
    
    const usersData = await usersQuery;
    const employeesData = await employeesQuery;
    
    // Combine both results
    users = [...usersData, ...employeesData];

    res.json({ 
      success: true, 
      data: users,
      message: 'Users fetched successfully'
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch users' 
    });
  }
};

// Get single user by ID
const getUserById = async (req, res) => {
  try {
    const { id } = req.params;
    const { company_id } = req.user;
    
    let user = null;
    
    // First try to find user in users table
    const userFromUsers = await db('users')
      .select(
        'users.id',
        'users.name',
        'users.email',
        'users.role',
        'users.department',
        'users.avatar',
        'users.created_at',
        'users.updated_at',
        'companies.company_name as company_name',
        db.raw('NULL as employee_id'),
        db.raw('NULL as first_name'),
        db.raw('NULL as last_name'),
        db.raw('NULL as status'),
        db.raw('NULL as department_id'),
        db.raw('NULL as designation_id'),
        db.raw('NULL as profile_photo'),
        db.raw('"users" as source_table')
      )
      .leftJoin('companies', 'users.company_id', 'companies.id')
      .where({ 'users.id': id })
      .first();
    
    // If not found in users table, try employees table
    if (!userFromUsers) {
      const userFromEmployees = await db('employees')
        .select(
          'employees.id',
          db.raw('CONCAT(employees.first_name, " ", employees.last_name) as name'),
          'employees.email',
          'employees.role',
          db.raw('NULL as department'),
          db.raw('NULL as avatar'),
          'employees.created_at',
          'employees.updated_at',
          'companies.company_name as company_name',
          'employees.employee_id',
          'employees.first_name',
          'employees.last_name',
          'employees.status',
          'employees.department_id',
          'employees.designation_id',
          db.raw('(SELECT file_path FROM employee_documents WHERE employee_id = employees.id AND fieldname = "photo" LIMIT 1) as profile_photo'),
          db.raw('"employees" as source_table')
        )
        .leftJoin('companies', 'employees.company_id', 'companies.id')
        .where({ 'employees.id': id })
        .first();
      
      user = userFromEmployees;
    } else {
      user = userFromUsers;
    }
    
    // Apply company filtering for non-superadmin
    if (user && req.user.role !== 'superadmin') {
      const userCompanyId = user.source_table === 'users' ? 
        await db('users').where('id', id).first().then(u => u?.company_id) :
        await db('employees').where('id', id).first().then(e => e?.company_id);
      
      if (userCompanyId !== company_id) {
        user = null;
      }
    }
      
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        error: 'User not found' 
      });
    }
    
    res.json({ 
      success: true, 
      data: user,
      message: 'User fetched successfully'
    });
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch user' 
    });
  }
};

// Create new user
const createUser = async (req, res) => {
  try {
    const { company_id } = req.user;
    const userData = {
      id: uuidv4(),
      company_id,
      ...req.body,
      created_at: new Date(),
      updated_at: new Date()
    };
    
    await db('users').insert(userData);
    
    // Assign default role if provided
    if (req.body.role_id) {
      await db('user_roles').insert({
        id: uuidv4(),
        user_id: userData.id,
        role_id: req.body.role_id,
        created_at: new Date()
      });
    }
    
    res.status(201).json({ 
      success: true, 
      data: { userId: userData.id },
      message: 'User created successfully' 
    });
  } catch (error) {
    console.error('Error creating user:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to create user' 
    });
  }
};

// Update user
const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { company_id } = req.user;
    
    const user = await db('users')
      .where({ id, company_id })
      .first();
      
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        error: 'User not found' 
      });
    }
    
    const updateData = {
      ...req.body,
      updated_at: new Date()
    };
    
    await db('users')
      .where({ id, company_id })
      .update(updateData);
      
    // Update role if provided
    if (req.body.role_id) {
      await db('user_roles')
        .where('user_id', id)
        .del();
        
      await db('user_roles').insert({
        id: uuidv4(),
        user_id: id,
        role_id: req.body.role_id,
        created_at: new Date()
      });
    }
    
    res.json({ 
      success: true, 
      data: updateData,
      message: 'User updated successfully' 
    });
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to update user' 
    });
  }
};

// Delete user
const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { company_id } = req.user;
    
    // First delete from user_roles
    await db('user_roles')
      .where('user_id', id)
      .del();
      
    // Then delete user
    const deleted = await db('users')
      .where({ id, company_id })
      .del();
      
    if (!deleted) {
      return res.status(404).json({ 
        success: false, 
        error: 'User not found' 
      });
    }
    
    res.json({ 
      success: true, 
      message: 'User deleted successfully' 
    });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to delete user' 
    });
  }
};

module.exports = {
  getUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser
};
