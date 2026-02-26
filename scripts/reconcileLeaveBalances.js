require('dotenv').config();

const knex = require('../db/db');
const { reconcileMissingLeaveBalances } = require('../services/leaveBalanceService');

const parseArg = (name) => {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  return raw ? raw.split('=')[1] : undefined;
};

const run = async () => {
  try {
    const companyIdArg = parseArg('companyId');
    const yearArg = parseArg('year');

    const result = await reconcileMissingLeaveBalances({
      companyId: companyIdArg ? Number(companyIdArg) : undefined,
      year: yearArg ? Number(yearArg) : undefined
    });

    console.log('Leave balance reconciliation completed.');
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  } catch (error) {
    console.error('Leave balance reconciliation failed:', error);
    process.exit(1);
  } finally {
    await knex.destroy();
  }
};

run();
