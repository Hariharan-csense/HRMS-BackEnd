const knex = require('../db/db');

/* ===========================
   GET ALL (company wise)
=========================== */
const getAllLeavePolicies = async (req, res) => {
  try {
    const companyId = req.user.company_id;

    const policies = await knex('leave_policies')
      .where({ company_id: companyId })
      .orderBy('created_at', 'desc');

    res.json(policies);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/* ===========================
   GET BY ID
=========================== */
const getLeavePolicyById = async (req, res) => {
  try {
    const companyId = req.user.company_id;
    const { id } = req.params;

    const policy = await knex('leave_policies')
      .where({ id, company_id: companyId })
      .first();

    if (!policy) {
      return res.status(404).json({ message: 'Leave policy not found' });
    }

    res.json(policy);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/* ===========================
   CREATE
=========================== */
const createLeavePolicy = async (req, res) => {
  try {
    const companyId = req.user.company_id;
    const { name, description, status } = req.body;

    const [id] = await knex('leave_policies').insert({
      company_id: companyId,
      name,
      description,
      status: status || 'active'
    });

    const newPolicy = await knex('leave_policies')
      .where({ id, company_id: companyId })
      .first();

    res.status(201).json(newPolicy);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/* ===========================
   UPDATE
=========================== */
const updateLeavePolicy = async (req, res) => {
  try {
    const companyId = req.user.company_id;
    const { id } = req.params;

    const policy = await knex('leave_policies')
      .where({ id, company_id: companyId })
      .first();

    if (!policy) {
      return res.status(404).json({ message: 'Leave policy not found' });
    }

    await knex('leave_policies')
      .where({ id, company_id: companyId })
      .update({
        ...req.body,
        updated_at: knex.fn.now()
      });

    const updatedPolicy = await knex('leave_policies')
      .where({ id, company_id: companyId })
      .first();

    res.json(updatedPolicy);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/* ===========================
   DELETE (soft delete)
=========================== */
const deleteLeavePolicy = async (req, res) => {
  try {
    const companyId = req.user.company_id;
    const { id } = req.params;

    const policy = await knex('leave_policies')
      .where({ id, company_id: companyId })
      .first();

    if (!policy) {
      return res.status(404).json({ message: 'Leave policy not found' });
    }

    await knex('leave_policies')
      .where({ id, company_id: companyId })
      .update({
        status: 'inactive',
        updated_at: knex.fn.now()
      });

    res.status(200).json({
      message: 'Leave policy deleted successfully'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  getAllLeavePolicies,
  getLeavePolicyById,
  createLeavePolicy,
  updateLeavePolicy,
  deleteLeavePolicy
};
