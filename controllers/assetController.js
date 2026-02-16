// src/controllers/assetController.js
const knex = require('../db/db');
const  {generateAutoNumber}  = require('../utils/generateAutoNumber');

// const addAsset = async (req, res) => {
//   const companyId = req.user.company_id;

//   if (!companyId) {
//     return res.status(400).json({ message: 'You are not assigned to any company' });
//   }

//   const {
//     name,
//     type,
//     serial_number,
//     issue_date,
//     status = 'Active',
//     location,
//     value = 0,
//     description
//   } = req.body;

//   if (!name?.trim() || !type?.trim() || !serial_number?.trim()) {
//     return res.status(400).json({
//       message: 'Asset Name, Type and Serial Number are required'
//     });
//   }

//   try {
//     await knex.transaction(async trx => {

//       // 🔍 Serial number unique per company
//       const existing = await trx('assets')
//         .where({
//           serial_number: serial_number.trim(),
//           company_id: companyId
//         })
//         .first();

//       if (existing) {
//         throw new Error('SERIAL_EXISTS');
//       }

//       // 🔥 AUTO ASSET ID (AST0001)
//       const asset_id = await generateAutoNumber(companyId, 'asset', trx);

//       const [newId] = await trx('assets').insert({
//         company_id: companyId,
//         asset_id,
//         name: name.trim(),
//         type: type.trim(),
//         serial_number: serial_number.trim(),
//         issue_date: issue_date || null,
//         status,
//         location: location?.trim() || null,
//         value: parseFloat(value) || 0,
//         description: description?.trim() || null
//       });

//       const newAsset = await trx('assets')
//         .where({ id: newId })
//         .first();

//       res.status(201).json({
//         success: true,
//         message: 'Asset added successfully!',
//         asset: newAsset
//       });
//     });

//   } catch (error) {
//     if (error.message === 'SERIAL_EXISTS') {
//       return res.status(400).json({
//         message: 'Serial Number already exists in your company'
//       });
//     }

//     console.error('Add asset error:', error);
//     res.status(500).json({ message: 'Server error' });
//   }
// };

const addAsset = async (req, res) => {
  const companyId = req.user.company_id;

  if (!companyId) {
    return res.status(400).json({ message: 'You are not assigned to any company' });
  }

  const {
    name,
    type,
    serial_number,
    assigned_employee_id,
    issue_date,
    status = 'Active',
    location,
    value = 0,
    description
  } = req.body;

  if (!name?.trim() || !type?.trim() || !serial_number?.trim()) {
    return res.status(400).json({
      message: 'Asset Name, Type and Serial Number are required'
    });
  }

  try {
    await knex.transaction(async trx => {
      // Serial number unique per company
      const existing = await trx('assets')
        .where({
          serial_number: serial_number.trim(),
          company_id: companyId
        })
        .first();

      if (existing) {
        throw new Error('SERIAL_EXISTS');
      }

      // Generate asset ID (AST0001 format)
      const lastAsset = await trx('assets')
        .where({ company_id: companyId })
        .orderBy('id', 'desc')
        .first();

      let nextNumber = 1;
      if (lastAsset && lastAsset.asset_id) {
        const match = lastAsset.asset_id.match(/AST(\d+)/);
        if (match) {
          nextNumber = parseInt(match[1]) + 1;
        }
      }

      const asset_id = `AST${nextNumber.toString().padStart(4, '0')}`;

      // Fetch employee name if assigned
      let employeeName = null;
      if (assigned_employee_id) {
        const employee = await trx('employees')
          .where({ id: parseInt(assigned_employee_id) })
          .select('first_name', 'last_name')
          .first();

        if (employee) {
          employeeName = `${employee.first_name || ''} ${employee.last_name || ''}`.trim();
        } else {
          throw new Error('EMPLOYEE_NOT_FOUND');
        }
      }

      const [newId] = await trx('assets').insert({
        company_id: companyId,
        asset_id,
        name: name.trim(),
        type: type.trim(),
        serial_number: serial_number.trim(),
        assigned_employee_id: assigned_employee_id ? parseInt(assigned_employee_id) : null,
        assigned_employee_name: employeeName,
        issue_date: issue_date || null,
        status,
        location: location?.trim() || null,
        value: parseFloat(value) || 0,
        description: description?.trim() || null
      });

      const newAsset = await trx('assets')
        .where({ id: newId })
        .first();

      res.status(201).json({
        success: true,
        message: 'Asset added successfully!',
        asset: newAsset
      });
    });

  } catch (error) {
    if (error.message === 'SERIAL_EXISTS') {
      return res.status(400).json({
        message: 'Serial Number already exists in your company'
      });
    }
    if (error.message === 'EMPLOYEE_NOT_FOUND') {
      return res.status(400).json({
        message: 'Assigned employee not found'
      });
    }

    console.error('Add asset error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};



const getAssets = async (req, res) => {
  const companyId = req.user.company_id;

  if (!companyId) {
    return res.status(400).json({ message: 'You are not assigned to any company' });
  }

  try {
    const assets = await knex('assets')
      .where({ company_id: companyId })
      .select('*')
      .orderBy('created_at', 'desc');

    res.json({
      success: true,
      count: assets.length,
      assets
    });
  } catch (error) {
    console.error('Get assets error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Update Asset (only within user's company)
// const updateAsset = async (req, res) => {
//   const companyId = req.user.company_id;

//   if (!companyId) {
//     return res.status(400).json({ message: 'You are not assigned to any company' });
//   }

//   const { id } = req.params;

//   const {
//     name,
//     type,
//     serial_number,
//     assigned_employee_id,
//     assigned_employee_name,
//     issue_date,
//     status,
//     location,
//     value,
//     description
//   } = req.body;

//   if (!name?.trim() || !type?.trim() || !serial_number?.trim()) {
//     return res.status(400).json({ message: 'Asset Name, Type and Serial Number are required' });
//   }

//   try {
//     // Verify asset belongs to user's company
//     const asset = await knex('assets')
//       .where({ id, company_id: companyId })
//       .first();

//     if (!asset) {
//       return res.status(404).json({ message: 'Asset not found or access denied' });
//     }

//     // Check duplicate serial number (exclude current asset, same company)
//     const existing = await knex('assets')
//       .where({
//         serial_number: serial_number.trim(),
//         company_id: companyId
//       })
//       .whereNot({ id })
//       .first();

//     if (existing) {
//       return res.status(400).json({ message: 'Serial Number already exists in your company' });
//     }

//     await knex('assets').where({ id }).update({
//       name: name.trim(),
//       type: type.trim(),
//       serial_number: serial_number.trim(),
//       assigned_employee_id: assigned_employee_id ? parseInt(assigned_employee_id) : null,
//       assigned_employee_name: assigned_employee_name?.trim() || null,
//       issue_date: issue_date || null,
//       status: status || asset.status,
//       location: location?.trim() || null,
//       value: parseFloat(value) || asset.value,
//       description: description?.trim() || null
//     });

//     const updated = await knex('assets').where({ id }).first();

//     res.json({
//       success: true,
//       message: 'Asset updated successfully!',
//       asset: updated
//     });

//   } catch (error) {
//     console.error('Update asset error:', error);
//     res.status(500).json({ message: 'Server error' });
//   }
// };

const updateAsset = async (req, res) => {
  const companyId = req.user.company_id;

  if (!companyId) {
    return res.status(400).json({ message: 'You are not assigned to any company' });
  }

  const { id } = req.params;

  const {
    name,
    type,
    serial_number,
    assigned_employee_id,
    assigned_employee_name, // This might not be sent from frontend, but keep for compatibility
    issue_date,
    status,
    location,
    value,
    description
  } = req.body;

  if (!name?.trim() || !type?.trim() || !serial_number?.trim()) {
    return res.status(400).json({ message: 'Asset Name, Type and Serial Number are required' });
  }

  try {
    // Verify asset belongs to user's company
    const asset = await knex('assets')
      .where({ id, company_id: companyId })
      .first();

    if (!asset) {
      return res.status(404).json({ message: 'Asset not found or access denied' });
    }

    // Check duplicate serial number (exclude current asset, same company)
    const existing = await knex('assets')
      .where({
        serial_number: serial_number.trim(),
        company_id: companyId
      })
      .whereNot({ id })
      .first();

    if (existing) {
      return res.status(400).json({ message: 'Serial Number already exists in your company' });
    }

    // Fetch employee name if assigned_employee_id is provided
    let employeeName = null;
    if (assigned_employee_id) {
      const employee = await knex('employees')
        .where({ id: parseInt(assigned_employee_id) })
        .select('first_name', 'last_name')
        .first();

      if (employee) {
        employeeName = `${employee.first_name || ''} ${employee.last_name || ''}`.trim();
      } else {
        return res.status(400).json({ message: 'Assigned employee not found' });
      }
    }

    await knex('assets').where({ id }).update({
      name: name.trim(),
      type: type.trim(),
      serial_number: serial_number.trim(),
      assigned_employee_id: assigned_employee_id ? parseInt(assigned_employee_id) : null,
      assigned_employee_name: employeeName, // Automatically fetched
      issue_date: issue_date || null,
      status: status || asset.status,
      location: location?.trim() || null,
      value: parseFloat(value) || asset.value,
      description: description?.trim() || null
    });

    const updated = await knex('assets').where({ id }).first();

    res.json({
      success: true,
      message: 'Asset updated successfully!',
      asset: updated
    });

  } catch (error) {
    console.error('Update asset error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Delete Asset (only within user's company)
const deleteAsset = async (req, res) => {
  const companyId = req.user.company_id;

  if (!companyId) {
    return res.status(400).json({ message: 'You are not assigned to any company' });
  }

  const { id } = req.params;

  try {
    const asset = await knex('assets')
      .where({ id, company_id: companyId })
      .first();

    if (!asset) {
      return res.status(404).json({ message: 'Asset not found or access denied' });
    }

    await knex('assets').where({ id }).del();

    res.json({
      success: true,
      message: 'Asset deleted successfully!'
    });

  } catch (error) {
    console.error('Delete asset error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = {
  addAsset,
  getAssets,
  updateAsset,
  deleteAsset
};