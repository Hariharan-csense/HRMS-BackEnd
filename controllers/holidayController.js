const knex = require('../db/db');

/* ===========================
   GET ALL HOLIDAYS (company)
=========================== */
const getAllHolidays = async (req, res) => {
  try {
    const companyId = req.user.company_id;

    const holidays = await knex('holidays')
      .select(
        'id',
        'name',
        'date',
        'type',
        'description',
        'createdAt AS createdAt'
      )
      .where({
        company_id: companyId
      })
      .orderBy('date', 'asc');

    const formattedHolidays = holidays.map(h => ({
      id: String(h.id),
      name: h.name,
      date: h.date,
      type: h.type,
      description: h.description || undefined,
      createdAt: new Date(h.createdAt).toISOString()
    }));

    res.json({
      success: true,
      holidays: formattedHolidays
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch holidays'
    });
  }
};

/* ===========================
   CREATE HOLIDAY
=========================== */
const createHoliday = async (req, res) => {
  try {
    const companyId = req.user.company_id;
    const { name, date, type, description } = req.body;

    if (!name || !date || !type) {
      return res.status(400).json({
        success: false,
        message: 'name, date and type are required'
      });
    }

    const [id] = await knex('holidays').insert({
      company_id: companyId,
      name,
      date,
      type,
      description: description ?? null
    });

    const holiday = await knex('holidays')
      .select(
        'id',
        'name',
        'date',
        'type',
        'description',
        'createdAt AS createdAt'
      )
      .where({ id, company_id: companyId })
      .first();

    res.status(201).json({
      success: true,
      holiday: {
        id: String(holiday.id),
        name: holiday.name,
        date: holiday.date,
        type: holiday.type,
        description: holiday.description || undefined,
        createdAt: new Date(holiday.createdAt).toISOString()
      }
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: 'Failed to create holiday'
    });
  }
};

/* ===========================
   UPDATE HOLIDAY
=========================== */
const updateHoliday = async (req, res) => {
  try {
    const companyId = req.user.company_id;
    const { id } = req.params;

    // Check if holiday exists
    const holiday = await knex('holidays')
      .where({ id, company_id: companyId })
      .first();

    if (!holiday) {
      return res.status(404).json({
        success: false,
        message: 'Holiday not found'
      });
    }

    // Update holiday (do NOT update createdAt)
    await knex('holidays')
      .where({ id, company_id: companyId })
      .update({
        ...req.body,
        description: req.body.description ?? null,
        updated_at: knex.fn.now()
      });

    // Fetch the updated holiday
    const updatedHoliday = await knex('holidays')
      .select(
        'id',
        'name',
        'date',
        'type',
        'description',
        'createdAt'
      )
      .where({ id, company_id: companyId })
      .first();

    // Return response with camelCase for JSON
    res.json({
      success: true,
      holiday: {
        id: String(updatedHoliday.id),
        name: updatedHoliday.name,
        date: updatedHoliday.date,
        type: updatedHoliday.type,
        description: updatedHoliday.description || undefined,
        createdAt: new Date(updatedHoliday.createdAt).toISOString()
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Failed to update holiday'
    });
  }
};


/* ===========================
   DELETE HOLIDAY (HARD)
=========================== */
const deleteHoliday = async (req, res) => {
  try {
    const companyId = req.user.company_id;
    const { id } = req.params;

    const deleted = await knex('holidays')
      .where({ id, company_id: companyId })
      .del();

    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: 'Holiday not found'
      });
    }

    res.json({
      success: true,
      message: 'Holiday deleted successfully'
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete holiday'
    });
  }
};

module.exports = {
  getAllHolidays,
  createHoliday,
  updateHoliday,
  deleteHoliday
};
