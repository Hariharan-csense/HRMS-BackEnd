const knex = require('../db/db');

const getAllChecklists = async (req, res) => {
  const company_id = req.user.company_id;

  try {
    const checklists = await knex('offboarding_checklists as o')
      .join('resignations as r', 'r.id', 'o.resignation_id')
      .select(
        'o.id',
        'o.resignation_id',
        'r.employee_id',
        'r.employee_name',
        'o.hr_clearance',
        'o.finance_clearance',
        'o.asset_return',
        'o.it_clearance',
        'o.final_settlement',
        'o.status',
        'o.completed_date'
      )
      .where('o.company_id', company_id)
      .orderBy('o.id', 'desc');

    res.json(checklists);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

/**
 * UPDATE checklist item
 * (company protected)
 */
const updateChecklistItem = async (req, res) => {
  const company_id = req.user.company_id;
  const { id } = req.params;
  const { field } = req.body;

  const allowedFields = [
    'hr_clearance',
    'finance_clearance',
    'asset_return',
    'it_clearance',
    'final_settlement'
  ];

  if (!allowedFields.includes(field)) {
    return res.status(400).json({ error: 'Invalid field' });
  }

  try {
    const checklist = await knex('offboarding_checklists')
      .where({ id, company_id })
      .first();

    if (!checklist) {
      return res.status(404).json({
        error: 'Checklist not found for your company'
      });
    }

    // toggle field
    await knex('offboarding_checklists')
      .where({ id, company_id })
      .update({ [field]: !checklist[field] });

    const updated = await knex('offboarding_checklists')
      .where({ id, company_id })
      .first();

    const allDone = allowedFields.every(f => updated[f]);

    await knex('offboarding_checklists')
      .where({ id, company_id })
      .update({
        status: allDone ? 'completed' : 'in-progress',
        completed_date: allDone
          ? new Date().toISOString().slice(0, 10)
          : null
      });

    const final = await knex('offboarding_checklists')
      .where({ id, company_id })
      .first();

    res.json(final);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = {
  getAllChecklists,
  updateChecklistItem
};
