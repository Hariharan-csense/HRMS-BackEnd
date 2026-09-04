const INTERNAL_COMPANY_CODE = String(
  process.env.INTERNAL_FULL_ACCESS_COMPANY_CODE || "COMP050",
)
  .trim()
  .toUpperCase();

const getInternalFullAccessCompany = async (companyId, db) => {
  if (!companyId || !db) return null;

  return db("companies")
    .where("id", companyId)
    .whereRaw("UPPER(TRIM(company_id)) = ?", [INTERNAL_COMPANY_CODE])
    .first();
};

module.exports = {
  INTERNAL_COMPANY_CODE,
  getInternalFullAccessCompany,
};
