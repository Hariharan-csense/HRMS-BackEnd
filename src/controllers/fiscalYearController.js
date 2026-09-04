const knex = require('../db/db');

/* ===========================
   GET ALL (company wise)
=========================== */
const getAllFiscalYears = async (req, res) => {
  try {
    const companyId = req.user.company_id;

    const fiscalYears = await knex('fiscal_year')
      .where({ company_id: companyId })
      .orderBy('start_date', 'desc');

    res.json(fiscalYears);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/* ===========================
   GET BY ID
=========================== */
const getFiscalYearById = async (req, res) => {
  try {
    const companyId = req.user.company_id;
    const { id } = req.params;

    const fiscalYear = await knex('fiscal_year')
      .where({ id, company_id: companyId })
      .first();

    if (!fiscalYear) {
      return res.status(404).json({ message: 'Fiscal year not found' });
    }

    res.json(fiscalYear);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/* ===========================
   CREATE
=========================== */
const createFiscalYear = async (req, res) => {
  try {
    const companyId = req.user.company_id;

    const {
      year,
      start_date,
      end_date,
      leave_cycle_start,
      is_active
    } = req.body;

    // 🔒 only one active fiscal year per company
    if (is_active) {
      await knex('fiscal_year')
        .where({ company_id: companyId, is_active: 1 })
        .update({ is_active: 0 });
    }

    const [id] = await knex('fiscal_year').insert({
      company_id: companyId,
      year,
      start_date,
      end_date,
      leave_cycle_start,
      is_active: is_active ? 1 : 0
    });

    const newFiscalYear = await knex('fiscal_year')
      .where({ id, company_id: companyId })
      .first();

    res.status(201).json(newFiscalYear);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/* ===========================
   UPDATE
=========================== */
const updateFiscalYear = async (req, res) => {
  try {
    const companyId = req.user.company_id;
    const { id } = req.params;

    // 🔍 check exists
    const fiscalYear = await knex('fiscal_year')
      .where({ id, company_id: companyId })
      .first();

    if (!fiscalYear) {
      return res.status(404).json({ message: 'Fiscal year not found' });
    }

    // 🔒 handle active year switch
    if (req.body.is_active) {
      await knex('fiscal_year')
        .where({ company_id: companyId, is_active: 1 })
        .whereNot({ id })
        .update({ is_active: 0 });
    }

    await knex('fiscal_year')
      .where({ id, company_id: companyId })
      .update({
        ...req.body,
        updated_at: knex.fn.now()
      });

    const updatedFiscalYear = await knex('fiscal_year')
      .where({ id, company_id: companyId })
      .first();

    res.json(updatedFiscalYear);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/* ===========================
   DELETE (hard delete)
=========================== */
const deleteFiscalYear = async (req, res) => {
  try {
    const companyId = req.user.company_id;
    const { id } = req.params;

    const deleted = await knex('fiscal_year')
      .where({ id, company_id: companyId })
      .del();

    if (!deleted) {
      return res.status(404).json({ message: 'Fiscal year not found' });
    }

    res.status(200).json({ message: 'Fiscal year deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  getAllFiscalYears,
  getFiscalYearById,
  createFiscalYear,
  updateFiscalYear,
  deleteFiscalYear
};
