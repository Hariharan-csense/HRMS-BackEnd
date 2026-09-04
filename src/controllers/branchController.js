// src/controllers/branchController.js
const knex = require('../db/db');
const {generateAutoNumber}  = require('../utils/generateAutoNumber');

// Auto generate Branch ID: BR001, BR002... per company


// Add Branch (Admin only - scoped to their company)
const addBranch = async (req, res) => {
  const companyId = req.user.company_id;

  if (!companyId) {
    return res.status(400).json({ message: 'You are not assigned to any company' });
  }

  const { name, address, coordinates, radius } = req.body;

  if (!name || !address || !coordinates || !radius) {
    return res.status(400).json({ message: 'All fields are required' });
  }

  const coordRegex = /^[-+]?[0-9]*\.?[0-9]+,\s*[-+]?[0-9]*\.?[0-9]+$/;
  if (!coordRegex.test(coordinates.trim())) {
    return res.status(400).json({ message: 'Invalid coordinates format. Use: latitude,longitude' });
  }

  const [lat, lng] = coordinates.trim().split(',').map(parseFloat);
  if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return res.status(400).json({ message: 'Invalid latitude or longitude values' });
  }

  if (isNaN(radius) || radius <= 0) {
    return res.status(400).json({ message: 'Radius must be a positive number' });
  }

  try {
    // Generate branch ID (BR001 format)
    const lastBranch = await knex('branches')
      .where({ company_id: companyId })
      .orderBy('id', 'desc')
      .first();

    let nextNumber = 1;
    if (lastBranch && lastBranch.branch_id) {
      const match = lastBranch.branch_id.match(/BR(\d+)/);
      if (match) {
        nextNumber = parseInt(match[1]) + 1;
      }
    }

    const branch_id = `BR${nextNumber.toString().padStart(3, '0')}`;

    const [newId] = await knex('branches').insert({
      company_id: companyId, // ← Company isolation
      branch_id,
      name: name.trim(),
      address: address.trim(),
      coordinates: coordinates.trim(),
      latitude: lat,
      longitude: lng,
      radius: parseInt(radius)
    });

    const newBranch = await knex('branches').where({ id: newId }).first();

    res.status(201).json({
      success: true,
      message: 'Branch added successfully!',
      branch: newBranch
    });

  } catch (error) {
    console.error('Add branch error:', error);
    res.status(500).json({ message: 'Server error while adding branch' });
  }
};

// Get All Branches (only from user's company)
const getBranches = async (req, res) => {
  const companyId = req.user.company_id;

  if (!companyId) {
    return res.status(400).json({ message: 'You are not assigned to any company' });
  }

  try {
    const branches = await knex('branches')
      .where({ company_id: companyId })
      .select('*')
      .orderBy('name');

    res.json({
      success: true,
      count: branches.length,
      branches
    });
  } catch (error) {
    console.error('Get branches error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Update Branch (company scoped)
const updateBranch = async (req, res) => {
  const companyId = req.user.company_id;

  if (!companyId) {
    return res.status(400).json({ message: 'You are not assigned to any company' });
  }

  const { id } = req.params;
  const { name, address, coordinates, radius } = req.body;

  if (!name || !address || !coordinates || !radius) {
    return res.status(400).json({ message: 'All fields are required' });
  }

  const coordRegex = /^[-+]?[0-9]*\.?[0-9]+,\s*[-+]?[0-9]*\.?[0-9]+$/;
  if (!coordRegex.test(coordinates.trim())) {
    return res.status(400).json({ message: 'Invalid coordinates format' });
  }

  const [lat, lng] = coordinates.trim().split(',').map(parseFloat);
  if (isNaN(lat) || isNaN(lng)) {
    return res.status(400).json({ message: 'Invalid coordinates' });
  }

  try {
    // Verify branch belongs to user's company
    const branch = await knex('branches')
      .where({ id, company_id: companyId })
      .first();

    if (!branch) {
      return res.status(404).json({ message: 'Branch not found or access denied' });
    }

    await knex('branches').where({ id }).update({
      name: name.trim(),
      address: address.trim(),
      coordinates: coordinates.trim(),
      latitude: lat,
      longitude: lng,
      radius: parseInt(radius)
    });

    const updatedBranch = await knex('branches').where({ id }).first();

    res.json({
      success: true,
      message: 'Branch updated successfully!',
      branch: updatedBranch
    });

  } catch (error) {
    console.error('Update branch error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Delete Branch (company scoped)
const deleteBranch = async (req, res) => {
  const companyId = req.user.company_id;

  if (!companyId) {
    return res.status(400).json({ message: 'You are not assigned to any company' });
  }

  const { id } = req.params;

  try {
    const branch = await knex('branches')
      .where({ id, company_id: companyId })
      .first();

    if (!branch) {
      return res.status(404).json({ message: 'Branch not found or access denied' });
    }

    await knex('branches').where({ id }).del();

    res.json({
      success: true,
      message: 'Branch deleted successfully!'
    });

  } catch (error) {
    console.error('Delete branch error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = {
  addBranch,
  getBranches,
  updateBranch,
  deleteBranch
};