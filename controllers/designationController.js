// src/controllers/designationController.js
const knex = require('../db/db');

// Auto generate Designation ID: DESG001, DESG002... per company
const generateDesgId = async (companyId) => {
  const lastDesg = await knex('designations')
    .where({ company_id: companyId })
    .orderBy('id', 'desc')
    .first();

  if (!lastDesg) return 'DESG001';

  const num = parseInt(lastDesg.desg_id.replace('DESG', '')) + 1;
  return `DESG${String(num).padStart(3, '0')}`;
};

// Add Designation (Admin only - scoped to company)
const addDesignation = async (req, res) => {
  const companyId = req.user.company_id;

  if (!companyId) {
    return res.status(400).json({ message: 'You are not assigned to any company' });
  }

  const { name, description } = req.body;

  if (!name?.trim()) {
    return res.status(400).json({ message: 'Name is required' });
  }

  try {
    // Check duplicate name within the same company
    const existing = await knex('designations')
      .whereRaw('LOWER(name) = ? AND company_id = ?', [name.trim().toLowerCase(), companyId])
      .first();

    if (existing) {
      return res.status(400).json({ message: 'Designation name already exists in your company' });
    }

    const desg_id = await generateDesgId(companyId);

    const [newId] = await knex('designations').insert({
      company_id: companyId, // ← Company isolation
      desg_id,
      name: name.trim(),
      description: description?.trim() || null
    });

    const newDesg = await knex('designations')
      .where({ id: newId })
      .select('id', 'desg_id', 'name', 'description', 'created_at', 'updated_at')
      .first();

    res.status(201).json({
      success: true,
      message: 'Designation added successfully!',
      designation: newDesg
    });

  } catch (error) {
    console.error('Add designation error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Get All Designations (only from user's company)
const getDesignations = async (req, res) => {
  const companyId = req.user.company_id;

  if (!companyId) {
    return res.status(400).json({ message: 'You are not assigned to any company' });
  }

  try {
    const designations = await knex('designations')
      .where({ company_id: companyId })
      .select('id', 'desg_id', 'name', 'description', 'created_at', 'updated_at')
      .orderBy('name');

    res.json({
      success: true,
      count: designations.length,
      designations
    });
  } catch (error) {
    console.error('Get designations error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Update Designation (company scoped)
const updateDesignation = async (req, res) => {
  const companyId = req.user.company_id;

  if (!companyId) {
    return res.status(400).json({ message: 'You are not assigned to any company' });
  }

  const { id } = req.params;
  const { name, description } = req.body;

  if (!name?.trim()) {
    return res.status(400).json({ message: 'Name is required' });
  }

  try {
    // Verify designation belongs to user's company
    const desg = await knex('designations')
      .where({ id, company_id: companyId })
      .first();

    if (!desg) {
      return res.status(404).json({ message: 'Designation not found or access denied' });
    }

    // Check duplicate name (exclude current, same company)
    const existing = await knex('designations')
      .whereRaw('LOWER(name) = ? AND company_id = ?', [name.trim().toLowerCase(), companyId])
      .whereNot({ id })
      .first();

    if (existing) {
      return res.status(400).json({ message: 'Designation name already exists in your company' });
    }

    await knex('designations').where({ id }).update({
      name: name.trim(),
      description: description?.trim() || null
    });

    const updated = await knex('designations')
      .where({ id })
      .select('id', 'desg_id', 'name', 'description', 'created_at', 'updated_at')
      .first();

    res.json({
      success: true,
      message: 'Designation updated successfully!',
      designation: updated
    });

  } catch (error) {
    console.error('Update designation error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Delete Designation (company scoped)
const deleteDesignation = async (req, res) => {
  const companyId = req.user.company_id;

  if (!companyId) {
    return res.status(400).json({ message: 'You are not assigned to any company' });
  }

  const { id } = req.params;

  try {
    const desg = await knex('designations')
      .where({ id, company_id: companyId })
      .first();

    if (!desg) {
      return res.status(404).json({ message: 'Designation not found or access denied' });
    }

    await knex('designations').where({ id }).del();

    res.json({
      success: true,
      message: 'Designation deleted successfully!'
    });

  } catch (error) {
    console.error('Delete designation error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = {
  addDesignation,
  getDesignations,
  updateDesignation,
  deleteDesignation
};