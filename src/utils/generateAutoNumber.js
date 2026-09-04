// utils/autoNumber.js
const knex = require('../db/db');

const generateAutoNumber = async (companyId, module) => {

  /* ---------- COMPANY AUTO NUMBER ---------- */
  if (module === 'company') {
    const lastCompany = await knex('companies')
      .select('id')
      .orderBy('id', 'desc')
      .first();

    const nextNumber = lastCompany ? lastCompany.id + 1 : 1;

    return `COMP${String(nextNumber).padStart(3, '0')}`;
  }

  /* ---------- OTHER MODULES ---------- */
  if (!companyId) {
    throw new Error('companyId is required for module: ' + module);
  }

  const settings = await knex('auto_number_settings')
    .where({ company_id: companyId, module })
    .first();

  if (!settings) {
    throw new Error(`Auto number settings not found for module: ${module}`);
  }

  const next = settings.current_number + 1;
  const numberStr = String(next).padStart(settings.number_length, '0');

  await knex('auto_number_settings')
    .where({ company_id: companyId, module })
    .update({ current_number: next });

  return `${settings.prefix}${numberStr}`;
};

module.exports = { generateAutoNumber };
