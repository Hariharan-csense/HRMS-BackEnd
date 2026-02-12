const knex = require('../db/db');

/**
 * GET – List all auto number settings (company wise)
 */
exports.getAutoNumbers = async (req, res) => {
  try {
    const companyId = req.user.company_id;

    const data = await knex('auto_number_settings')
      .where({ company_id: companyId })
      .orderBy('module');

    res.json({ success: true, data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST – Create new module auto number
 */
exports.createAutoNumber = async (req, res) => {
  try {
    const companyId = req.user.company_id;
    const {
      module,
      prefix,
      start_number = 1,
      number_length = 4
    } = req.body;

    if (!module || !prefix) {
      return res.status(400).json({
        message: 'Module and Prefix are required'
      });
    }

    const exists = await knex('auto_number_settings')
      .where({ company_id: companyId, module })
      .first();

    if (exists) {
      return res.status(400).json({
        message: 'This module already exists'
      });
    }

    await knex('auto_number_settings').insert({
      company_id: companyId,
      module,
      prefix,
      start_number,
      current_number: start_number - 1,
      number_length
    });

    res.status(201).json({
      success: true,
      message: 'Auto number setting created'
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

/**
 * PUT – Update prefix / range
 */
exports.updateAutoNumber = async (req, res) => {
  try {
    const companyId = req.user.company_id;
    const { id } = req.params;

    const {
      prefix,
      start_number,
      current_number,
      number_length,module
    } = req.body;

    console.log('Update request:', { id, companyId, prefix, start_number, current_number, number_length });

    const record = await knex('auto_number_settings')
      .where({ id, company_id: companyId })
      .first();

    if (!record) {
      console.log('Record not found for:', { id, companyId });
      return res.status(404).json({ message: 'Record not found' });
    }

    console.log('Existing record:', record);

    const updateData = {
      prefix: prefix !== undefined ? prefix : record.prefix,
      start_number: start_number !== undefined ? start_number : record.start_number,
      current_number: current_number !== undefined ? current_number : record.current_number,
      number_length: number_length !== undefined ? number_length : record.number_length,
      module: module !== undefined ? module : record.module
    };

    console.log('Update data:', updateData);

    const result = await knex('auto_number_settings')
      .where({ id, company_id: companyId })
      .update(updateData);

    console.log('Update result:', result);

    res.json({
      success: true,
      message: 'Auto number updated',
      data: updateData
    });
  } catch (err) {
    console.error('Error updating auto number:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

/**
 * DELETE – Remove module config
 */
exports.deleteAutoNumber = async (req, res) => {
  try {
    const companyId = req.user.company_id;
    const { id } = req.params;

    const deleted = await knex('auto_number_settings')
      .where({ id, company_id: companyId })
      .del();

    if (!deleted) {
      return res.status(404).json({ message: 'Record not found' });
    }

    res.json({
      success: true,
      message: 'Auto number setting deleted'
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};
