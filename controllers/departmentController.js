// src/controllers/departmentController.js
const knex = require('../db/db');
const {generateAutoNumber} = require('../utils/generateAutoNumber');


const addDepartment = async (req, res) => {
  const companyId = req.user.company_id;

  if (!companyId) {
    return res.status(400).json({ message: 'You are not assigned to any company' });
  }

  const { name, head_name, description } = req.body;

  if (!name?.trim()) {
    return res.status(400).json({ message: 'Department name is required' });
  }

  try {
    // Check duplicate name within the same company
    const existing = await knex('departments')
      .where({ 
        name: name.trim(),
        company_id: companyId 
      })
      .first();

    if (existing) {
      return res.status(400).json({ message: 'Department name already exists in your company' });
    }

    // Generate department ID (DEP001 format)
    const lastDept = await knex('departments')
      .where({ company_id: companyId })
      .orderBy('id', 'desc')
      .first();

    let nextDeptNumber = 1;
    if (lastDept && lastDept.dept_id) {
      const match = lastDept.dept_id.match(/DEP(\d+)/);
      if (match) {
        nextDeptNumber = parseInt(match[1]) + 1;
      }
    }

    const dept_id = `DEP${nextDeptNumber.toString().padStart(3, '0')}`;

    // Generate cost center (CC001 format)
    const lastCostCenter = await knex('departments')
      .where({ company_id: companyId })
      .orderBy('id', 'desc')
      .first();

    let nextCostNumber = 1;
    if (lastCostCenter && lastCostCenter.cost_center) {
      const match = lastCostCenter.cost_center.match(/CC(\d+)/);
      if (match) {
        nextCostNumber = parseInt(match[1]) + 1;
      }
    }

    const cost_center = `CC${nextCostNumber.toString().padStart(3, '0')}`;

    const [newId] = await knex('departments').insert({
      company_id: companyId, // ← Company isolation
      dept_id,
      name: name.trim(),
      cost_center,
      head_name: head_name?.trim() || null,
      head_id: null, // will link later
      description: description?.trim() || null
    });

    const newDept = await knex('departments')
      .where({ id: newId })
      .select('id', 'dept_id', 'name', 'cost_center', 'head_name', 'description', 'created_at', 'updated_at')
      .first();

    res.status(201).json({
      success: true,
      message: 'Department added successfully!',
      department: newDept
    });

  } catch (error) {
    console.error('Add department error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Get All Departments (only from user's company)
const getDepartments = async (req, res) => {
  const companyId = req.user.company_id;

  if (!companyId) {
    return res.status(400).json({ message: 'You are not assigned to any company' });
  }

  try {
    const departments = await knex('departments')
      .where({ company_id: companyId })
      .select('id', 'dept_id', 'name', 'cost_center', 'head_name', 'description', 'created_at', 'updated_at')
      .orderBy('name');

    res.json({
      success: true,
      count: departments.length,
      departments
    });
  } catch (error) {
    console.error('Get departments error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Update Department (company scoped)
const updateDepartment = async (req, res) => {
  const companyId = req.user.company_id;

  if (!companyId) {
    return res.status(400).json({ message: 'You are not assigned to any company' });
  }

  const { id } = req.params;
  const { name, head_name, description } = req.body;

  if (!name?.trim()) {
    return res.status(400).json({ message: 'Department name is required' });
  }

  try {
    // Verify department belongs to user's company
    const dept = await knex('departments')
      .where({ id, company_id: companyId })
      .first();

    if (!dept) {
      return res.status(404).json({ message: 'Department not found or access denied' });
    }

    // Check duplicate name (exclude current, same company)
    const existing = await knex('departments')
      .where({
        name: name.trim(),
        company_id: companyId
      })
      .whereNot({ id })
      .first();

    if (existing) {
      return res.status(400).json({ message: 'Department name already exists in your company' });
    }

    await knex('departments').where({ id }).update({
      name: name.trim(),
      head_name: head_name?.trim() || null,
      description: description?.trim() || null
    });

    const updated = await knex('departments')
      .where({ id })
      .select('id', 'dept_id', 'name', 'cost_center', 'head_name', 'description', 'created_at', 'updated_at')
      .first();

    res.json({
      success: true,
      message: 'Department updated successfully!',
      department: updated
    });

  } catch (error) {
    console.error('Update department error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Delete Department (company scoped)
const deleteDepartment = async (req, res) => {
  const companyId = req.user.company_id;

  if (!companyId) {
    return res.status(400).json({ message: 'You are not assigned to any company' });
  }

  const { id } = req.params;

  try {
    const dept = await knex('departments')
      .where({ id, company_id: companyId })
      .first();

    if (!dept) {
      return res.status(404).json({ message: 'Department not found or access denied' });
    }

    await knex('departments').where({ id }).del();

    res.json({
      success: true,
      message: 'Department deleted successfully!'
    });

  } catch (error) {
    console.error('Delete department error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = {
  addDepartment,
  getDepartments,
  updateDepartment,
  deleteDepartment
};