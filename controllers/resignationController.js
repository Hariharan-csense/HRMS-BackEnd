const knex = require('../db/db');

/**
 * GET all resignations (logged-in user's company)
 */
const getAllResignations = async (req, res) => {
  const company_id = req.user.company_id;

  try {
    const resignations = await knex('resignations')
      .select(
        'id',
        'employee_id',
        'employee_name',
        'resignation_date',
        'last_working_day',
        'reason',
        'approval_status',
        'created_at'
      )
      .where({ company_id })
      .orderBy('created_at', 'desc');

    res.json(resignations);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

/**
 * CREATE resignation (employee_name manual entry)
 */
const createResignation = async (req, res) => {
  const company_id = req.user.company_id;

  const {
    employee_id, // optional
    employee_name,
    resignation_date,
    last_working_day,
    reason,
    approval_status = 'pending'
  } = req.body;

  if (!employee_name || !resignation_date || !last_working_day) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    // ✅ employee belongs to company check (if id provided)
    if (employee_id) {
      const employee = await knex('employees')
        .where({ id: employee_id, company_id })
        .first();

      if (!employee) {
        return res.status(403).json({ error: 'Employee does not belong to your company' });
      }
    }

    // 🔹 Insert resignation
    const [resignation_id] = await knex('resignations').insert({
      company_id,
      employee_id: employee_id || null,
      employee_name,
      resignation_date,
      last_working_day,
      reason,
      approval_status,
      created_at: new Date().toISOString().slice(0, 10)
    });

    const createdResignation = await knex('resignations')
      .where({ id: resignation_id, company_id })
      .first();

    // 🔹 Auto-create offboarding checklist
    await knex('offboarding_checklists').insert({
      company_id,
      resignation_id,
      hr_clearance: false,
      finance_clearance: false,
      asset_return: false,
      it_clearance: false,
      final_settlement: false,
      status: 'in-progress',
      completed_date: null
    });

    res.status(201).json(createdResignation);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};


/**
 * UPDATE resignation (company protected)
 */
const updateResignation = async (req, res) => {
  const company_id = req.user.company_id;
  const { id } = req.params;

  const {
    employee_id,        // optional
    employee_name,
    resignation_date,
    last_working_day,
    reason,
    approval_status
  } = req.body;

  try {
    // 🔍 check resignation exists for company
    const resignation = await knex('resignations')
      .where({ id, company_id })
      .first();

    if (!resignation) {
      return res.status(404).json({ error: 'Resignation not found' });
    }

    // ✅ if employee_id provided, validate company ownership
    if (employee_id) {
      const employee = await knex('employees')
        .where({ id: employee_id, company_id })
        .first();

      if (!employee) {
        return res.status(403).json({
          error: 'Employee does not belong to your company'
        });
      }
    }

    // 🧼 build update object safely
    const updates = {
      ...(employee_id !== undefined && { employee_id: employee_id || null }),
      ...(employee_name && { employee_name }),
      ...(resignation_date && { resignation_date }),
      ...(last_working_day && { last_working_day }),
      ...(reason && { reason }),
      ...(approval_status && { approval_status })
    };

    // 🚫 no valid fields
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    await knex('resignations')
      .where({ id, company_id })
      .update(updates);

    const updated = await knex('resignations')
      .where({ id, company_id })
      .first();

    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};


module.exports = {
  getAllResignations,
  createResignation,
  updateResignation
};
