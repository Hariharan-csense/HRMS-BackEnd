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
  if (!name?.trim() || !approval_authority?.trim() || !data_visibility?.trim()) {
    return res.status(400).json({
      message: 'Name, Approval Authority and Data Visibility are required'
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

    const role_id = await generateAutoNumber(companyId,'ROLE');

    // Normalize permissions to 0/1 numeric
    const structuredModules = {};
    Object.keys(modules).forEach(mod => {
      structuredModules[mod] = {
        view: modules[mod]?.view ? 1 : 0,
        create: modules[mod]?.create ? 1 : 0,
        edit: modules[mod]?.edit ? 1 : 0,
        approve: modules[mod]?.approve ? 1 : 0
      };
    });

    const [newId] = await knex('roles').insert({
      company_id: companyId, // ← Company isolation
      role_id,
      name: name.trim(),
      approval_authority: approval_authority.trim(),
      data_visibility: data_visibility.trim(),
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

  if (!name?.trim() || !approval_authority?.trim() || !data_visibility?.trim()) {
    return res.status(400).json({ message: 'Name, Approval Authority and Data Visibility are required' });
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
        view: modules[mod]?.view ? 1 : 0,
        create: modules[mod]?.create ? 1 : 0,
        edit: modules[mod]?.edit ? 1 : 0,
        approve: modules[mod]?.approve ? 1 : 0
      };
    });

    await knex('roles').where({ id }).update({
      name: name.trim(),
      approval_authority: approval_authority.trim(),
      data_visibility: data_visibility.trim(),
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

module.exports = {
  addRole,
  getRoles,
  updateRole,
  deleteRole
};