const knex = require('../db/db');
const { generateAutoNumber } = require('../utils/generateAutoNumber');

exports.createLeaveType = async (req, res) => {
  try {
    const companyId = req.user.company_id; // 🔐 from JWT

    const {
      name,
      is_paid,
      annual_limit,
      carry_forward,
      encashable,
      description
    } = req.body;

    // validation
    if (!name || annual_limit === undefined) {
      return res.status(400).json({
        message: 'name and annual_limit are required'
      });
    }

    // 🔢 AUTO GENERATE leave_type_id (LVT001 format)
    const lastLeaveType = await knex('leave_types')
      .where({ company_id: companyId })
      .orderBy('id', 'desc')
      .first();

    let nextNumber = 1;
    if (lastLeaveType && lastLeaveType.leave_type_id) {
      const match = lastLeaveType.leave_type_id.match(/LVT(\d+)/);
      if (match) {
        nextNumber = parseInt(match[1]) + 1;
      }
    }

    const leaveTypeId = `LVT${nextNumber.toString().padStart(3, '0')}`;

    await knex('leave_types').insert({
      company_id: companyId,
      leave_type_id: leaveTypeId,
      name,
      is_paid: is_paid ?? 1,
      annual_limit,
      carry_forward: carry_forward ?? 0,
      encashable: encashable ?? 0,
      description: description ?? null,
      status: 'active'
    });

    return res.status(201).json({
      message: 'Leave type created successfully',
      leave_type_id: leaveTypeId
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: error.message || 'Internal server error'
    });
  }
};

exports.updateLeaveTypeById = async (req, res) => {
  try {
    const companyId = req.user.company_id;
    const id = Number(req.params.id); // 🔥 force number

    const {
      name,
      is_paid,
      annual_limit,
      carry_forward,
      encashable,
      description,
      status
    } = req.body;

    // 🔍 Check record exists first
    const leaveType = await knex('leave_types')
      .where({ id })
      .first();

    if (!leaveType) {
      return res.status(404).json({
        message: 'Leave type not found'
      });
    }

    // 🔐 Company check
    if (leaveType.company_id !== companyId) {
      return res.status(403).json({
        message: 'Unauthorized to update this leave type'
      });
    }

    await knex('leave_types')
      .where({ id })
      .update({
        name,
        is_paid,
        annual_limit,
        carry_forward,
        encashable,
        description,
        status,
        updated_at: knex.fn.now()
      });

    return res.status(200).json({
      message: 'Leave type updated successfully'
    });

  } catch (error) {
    console.error(error);
    return res.status(500).json({
      message: 'Internal server error'
    });
  }
};

exports.deleteLeaveTypeById = async (req, res) => {
  try {
    const companyId = req.user.company_id;
    const id = Number(req.params.id); // ensure number

    // 🔍 check record exists
    const leaveType = await knex('leave_types')
      .where({ id })
      .first();

    if (!leaveType) {
      return res.status(404).json({
        message: 'Leave type not found'
      });
    }

    // 🔐 company validation
    if (leaveType.company_id !== companyId) {
      return res.status(403).json({
        message: 'Unauthorized to delete this leave type'
      });
    }

    // 🧹 soft delete
    await knex('leave_types')
      .where({ id })
      .update({
        status: 'inactive',
        updated_at: knex.fn.now()
      });

    return res.status(200).json({
      message: 'Leave type deleted successfully'
    });

  } catch (error) {
    console.error(error);
    return res.status(500).json({
      message: 'Internal server error'
    });
  }
};