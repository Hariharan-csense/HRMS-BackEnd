// src/controllers/roleController.js
const knex = require('../db/db');
const { generateAutoNumber } = require('../utils/generateAutoNumber');

// Auto generate Role ID: ROLE001, ROLE002... per company
const generateRoleId = async (companyId) => {
  const lastRole = await knex('roles')
    .where({ company_id: companyId })
    .orderBy('id', 'desc')
    .first();

  if (!lastRole) return 'ROLE001';

  const num = parseInt(lastRole.role_id.replace('ROLE', '')) + 1;
  return `ROLE${String(num).padStart(3, '0')}`;
};

// Add Role (Admin only - scoped to company)
const addRole = async (req, res) => {
  const companyId = req.user.company_id;

  if (!companyId) {
    return res.status(400).json({ message: 'You are not assigned to any company' });
  }

  const {
    name,
    approval_authority,
    data_visibility,
    modules,
    description
  } = req.body;

  // Basic validation
  if (!name?.trim()) {
    return res.status(400).json({
      message: 'Role name is required'
    });
  }

  if (!modules || typeof modules !== 'object' || Object.keys(modules).length === 0) {
    return res.status(400).json({
      message: 'At least one module permission is required'
    });
  }

  try {
    // Check duplicate role name within the same company
    const existing = await knex('roles')
      .whereRaw('LOWER(name) = ? AND company_id = ?', [name.trim().toLowerCase(), companyId])
      .first();

    if (existing) {
      return res.status(400).json({ message: 'Role name already exists in your company' });
    }

    const role_id = await generateRoleId(companyId);

    // Normalize permissions to 0/1 numeric for each action
    const structuredModules = {};
    Object.keys(modules).forEach(mod => {
      structuredModules[mod] = {
        create: modules[mod]?.create ? 1 : 0,
        edit: modules[mod]?.edit ? 1 : 0,
        view: modules[mod]?.view ? 1 : 0,
        approve: modules[mod]?.approve ? 1 : 0,
        reject: modules[mod]?.reject ? 1 : 0
      };
    });

    const [newId] = await knex('roles').insert({
      company_id: companyId,
      role_id,
      name: name.trim(),
      approval_authority: (approval_authority || '').trim(),
      data_visibility: (data_visibility || '').trim(),
      modules: JSON.stringify(structuredModules),
      description: description?.trim() || null
    });

    const newRole = await knex('roles')
      .where({ id: newId })
      .first();

    newRole.modules = JSON.parse(newRole.modules);

    res.status(201).json({
      success: true,
      message: 'Role added successfully!',
      role: newRole
    });

  } catch (error) {
    console.error('Add role error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Get All Roles (only from user's company)
const getRoles = async (req, res) => {
  const companyId = req.user.company_id;

  if (!companyId) {
    return res.status(400).json({ message: 'You are not assigned to any company' });
  }

  try {
    const roles = await knex('roles')
      .where({ company_id: companyId })
      .select('id', 'role_id', 'name', 'approval_authority', 'data_visibility', 'modules', 'description', 'created_at', 'updated_at')
      .orderBy('name');

    const parsedRoles = roles.map(role => ({
      ...role,
      modules: JSON.parse(role.modules)
    }));

    res.json({
      success: true,
      count: parsedRoles.length,
      roles: parsedRoles
    });
  } catch (error) {
    console.error('Get roles error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Update Role (company scoped)
const updateRole = async (req, res) => {
  const companyId = req.user.company_id;

  if (!companyId) {
    return res.status(400).json({ message: 'You are not assigned to any company' });
  }

  const { id } = req.params;
  const { name, approval_authority, data_visibility, modules, description } = req.body;

  if (!name?.trim()) {
    return res.status(400).json({ message: 'Role name is required' });
  }

  try {
    // Verify role belongs to user's company
    const role = await knex('roles')
      .where({ id, company_id: companyId })
      .first();

    if (!role) {
      return res.status(404).json({ message: 'Role not found or access denied' });
    }

    // Check duplicate name (exclude current, same company)
    const existing = await knex('roles')
      .whereRaw('LOWER(name) = ? AND company_id = ?', [name.trim().toLowerCase(), companyId])
      .whereNot({ id })
      .first();

    if (existing) {
      return res.status(400).json({ message: 'Role name already exists in your company' });
    }

    const currentModules = JSON.parse(role.modules);
    const updatedModules = { ...currentModules };

    // Update only provided modules
    Object.keys(modules || {}).forEach(mod => {
      updatedModules[mod] = {
        create: modules[mod]?.create ? 1 : 0,
        edit: modules[mod]?.edit ? 1 : 0,
        view: modules[mod]?.view ? 1 : 0,
        approve: modules[mod]?.approve ? 1 : 0,
        reject: modules[mod]?.reject ? 1 : 0
      };
    });

    await knex('roles').where({ id }).update({
      name: name.trim(),
      approval_authority:
        typeof approval_authority === 'string'
          ? approval_authority.trim()
          : (role.approval_authority || ''),
      data_visibility:
        typeof data_visibility === 'string'
          ? data_visibility.trim()
          : (role.data_visibility || ''),
      modules: JSON.stringify(updatedModules),
      description: description?.trim() || null
    });

    const updated = await knex('roles').where({ id }).first();
    updated.modules = JSON.parse(updated.modules);

    res.json({
      success: true,
      message: 'Role updated successfully!',
      role: updated
    });

  } catch (error) {
    console.error('Update role error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Delete Role (company scoped)
const deleteRole = async (req, res) => {
  const companyId = req.user.company_id;

  if (!companyId) {
    return res.status(400).json({ message: 'You are not assigned to any company' });
  }

  const { id } = req.params;

  try {
    const role = await knex('roles')
      .where({ id, company_id: companyId })
      .first();

    if (!role) {
      return res.status(404).json({ message: 'Role not found or access denied' });
    }

    // Prevent deleting critical roles
    if (role.name.toLowerCase() === 'admin') {
      return res.status(403).json({ message: 'Cannot delete Admin role' });
    }

    // Check if role is assigned to any employees
    const assignments = await knex('role_assignments')
      .where({ role_id: id, company_id: companyId, status: 'Active' })
      .first();

    if (assignments) {
      return res.status(400).json({ 
        message: 'Cannot delete role that is assigned to employees. Please remove assignments first.' 
      });
    }

    await knex('roles').where({ id }).del();

    res.json({
      success: true,
      message: 'Role deleted successfully!'
    });

  } catch (error) {
    console.error('Delete role error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Assign Role to Employee
const assignRoleToEmployee = async (req, res) => {
  const companyId = req.user.company_id;

  if (!companyId) {
    return res.status(400).json({ message: 'You are not assigned to any company' });
  }

  const { employee_id, role_id, remarks } = req.body;

  if (!employee_id || !role_id) {
    return res.status(400).json({ message: 'Employee ID and Role ID are required' });
  }

  try {
    // Verify employee belongs to user's company
    const employee = await knex('employees')
      .where({ id: employee_id, company_id: companyId })
      .first();

    if (!employee) {
      return res.status(404).json({ message: 'Employee not found or access denied' });
    }

    // Verify role belongs to user's company
    const role = await knex('roles')
      .where({ id: role_id, company_id: companyId })
      .first();

    if (!role) {
      return res.status(404).json({ message: 'Role not found or access denied' });
    }

    // Check if employee already has an active role
    const existingAssignment = await knex('role_assignments')
      .where({ employee_id, company_id, status: 'Active' })
      .first();

    if (existingAssignment) {
      return res.status(400).json({ message: 'Employee already has an active role assigned' });
    }

    // Create role assignment
    const [assignmentId] = await knex('role_assignments').insert({
      employee_id,
      role_id,
      company_id: companyId,
      status: 'Active',
      assigned_date: new Date(),
      remarks: remarks?.trim() || null
    });

    const assignment = await knex('role_assignments')
      .where({ id: assignmentId })
      .first();

    res.status(201).json({
      success: true,
      message: 'Role assigned successfully!',
      assignment: {
        ...assignment,
        employee_name: `${employee.first_name} ${employee.last_name}`,
        role_name: role.name
      }
    });

  } catch (error) {
    console.error('Assign role error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Remove Role from Employee
const removeRoleFromEmployee = async (req, res) => {
  const companyId = req.user.company_id;

  if (!companyId) {
    return res.status(400).json({ message: 'You are not assigned to any company' });
  }

  const { id } = req.params; // assignment ID

  try {
    const assignment = await knex('role_assignments')
      .where({ id, company_id: companyId })
      .first();

    if (!assignment) {
      return res.status(404).json({ message: 'Role assignment not found or access denied' });
    }

    if (assignment.status !== 'Active') {
      return res.status(400).json({ message: 'Role assignment is already inactive' });
    }

    // Deactivate the assignment
    await knex('role_assignments')
      .where({ id })
      .update({
        status: 'Inactive',
        removed_date: new Date()
      });

    res.json({
      success: true,
      message: 'Role removed successfully!'
    });

  } catch (error) {
    console.error('Remove role error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Get Employee Roles
const getEmployeeRoles = async (req, res) => {
  const companyId = req.user.company_id;

  if (!companyId) {
    return res.status(400).json({ message: 'You are not assigned to any company' });
  }

  const { employee_id } = req.params;

  try {
    // Verify employee belongs to user's company
    const employee = await knex('employees')
      .where({ id: employee_id, company_id: companyId })
      .first();

    if (!employee) {
      return res.status(404).json({ message: 'Employee not found or access denied' });
    }

    const assignments = await knex('role_assignments')
      .leftJoin('roles', 'role_assignments.role_id', 'roles.id')
      .where({
        'role_assignments.employee_id': employee_id,
        'role_assignments.company_id': companyId
      })
      .select(
        'role_assignments.id',
        'role_assignments.status',
        'role_assignments.assigned_date',
        'role_assignments.removed_date',
        'role_assignments.remarks',
        'roles.id as role_id',
        'roles.role_id as role_code',
        'roles.name as role_name',
        'roles.approval_authority',
        'roles.data_visibility',
        'roles.modules',
        'roles.description'
      )
      .orderBy('role_assignments.assigned_date', 'desc');

    const parsedAssignments = assignments.map(assignment => ({
      ...assignment,
      modules: assignment.modules ? JSON.parse(assignment.modules) : null
    }));

    res.json({
      success: true,
      employee: {
        id: employee.id,
        name: `${employee.first_name} ${employee.last_name}`,
        email: employee.email
      },
      count: parsedAssignments.length,
      assignments: parsedAssignments
    });

  } catch (error) {
    console.error('Get employee roles error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Get All Role Assignments (company scoped)
const getRoleAssignments = async (req, res) => {
  const companyId = req.user.company_id;

  if (!companyId) {
    return res.status(400).json({ message: 'You are not assigned to any company' });
  }

  try {
    const assignments = await knex('role_assignments')
      .leftJoin('employees', 'role_assignments.employee_id', 'employees.id')
      .leftJoin('roles', 'role_assignments.role_id', 'roles.id')
      .where({
        'role_assignments.company_id': companyId
      })
      .select(
        'role_assignments.id',
        'role_assignments.status',
        'role_assignments.assigned_date',
        'role_assignments.removed_date',
        'role_assignments.remarks',
        'employees.id as employee_id',
        'employees.employee_id as employee_code',
        'employees.first_name',
        'employees.last_name',
        'employees.email',
        'roles.id as role_id',
        'roles.role_id as role_code',
        'roles.name as role_name'
      )
      .orderBy('role_assignments.assigned_date', 'desc');

    res.json({
      success: true,
      count: assignments.length,
      assignments: assignments.map(assignment => ({
        ...assignment,
        employee_name: `${assignment.first_name} ${assignment.last_name}`
      }))
    });

  } catch (error) {
    console.error('Get role assignments error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = {
  addRole,
  getRoles,
  updateRole,
  deleteRole,
  assignRoleToEmployee,
  removeRoleFromEmployee,
  getEmployeeRoles,
  getRoleAssignments
};
