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

    // 🔹 Auto-create offboarding checklist only if resignation is approved
    if (approval_status === 'approved') {
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
    }

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
    approval_status,
    status              // frontend sends status, map to approval_status
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
    const finalApprovalStatus = status || approval_status; // Use status if provided, fallback to approval_status
    const updates = {
      ...(employee_id !== undefined && { employee_id: employee_id || null }),
      ...(employee_name && { employee_name }),
      ...(resignation_date && { resignation_date }),
      ...(last_working_day && { last_working_day }),
      ...(reason && { reason }),
      ...(finalApprovalStatus && { approval_status: finalApprovalStatus })
    };

    // 🚫 no valid fields
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    await knex('resignations')
      .where({ id, company_id })
      .update(updates);

    // 🔹 If approval_status changed to 'approved', create offboarding checklist
    if (finalApprovalStatus && finalApprovalStatus === 'approved' && resignation.approval_status !== 'approved') {
      // Check if checklist already exists
      const existingChecklist = await knex('offboarding_checklists')
        .where({ resignation_id: id, company_id })
        .first();

      if (!existingChecklist) {
        await knex('offboarding_checklists').insert({
          company_id,
          resignation_id: id,
          hr_clearance: false,
          finance_clearance: false,
          asset_return: false,
          it_clearance: false,
          final_settlement: false,
          status: 'in-progress',
          completed_date: null
        });
        console.log(`Offboarding checklist created for approved resignation ${id}`);
      }
    }

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
