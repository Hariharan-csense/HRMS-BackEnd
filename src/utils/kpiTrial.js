const moment = require("moment");
const db = require("../db/db");

const getKpiFreeUntil = async (companyId, database = db) => {
  if (!companyId) return null;
  const company = await database("companies")
    .where({ id: companyId })
    .first("created_at");
  if (!company?.created_at) return null;
  return moment.utc(company.created_at).add(3, "months").toDate();
};

const hasKpiFreeAccess = async (companyId, now = new Date(), database = db) => {
  const freeUntil = await getKpiFreeUntil(companyId, database);
  return Boolean(freeUntil && moment.utc(now).isBefore(freeUntil));
};

module.exports = { getKpiFreeUntil, hasKpiFreeAccess };
