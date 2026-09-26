const parseTiers = (value) =>
  typeof value === "string" ? JSON.parse(value) : value || [];
const validateTiers = (value) => {
  const tiers = parseTiers(value);
  if (!Array.isArray(tiers)) throw new Error("Pricing tiers must be a list");
  let next = 1;
  tiers.forEach((tier, index) => {
    if (
      !Number.isInteger(tier.min_users) ||
      tier.min_users !== next ||
      (tier.max_users !== null &&
        (!Number.isInteger(tier.max_users) ||
          tier.max_users < tier.min_users)) ||
      (tier.max_users === null && index !== tiers.length - 1) ||
      ![tier.price, tier.yearly_price].every(
        (n) => typeof n === "number" && Number.isFinite(n) && n >= 0,
      )
    )
      throw new Error(
        "Use consecutive employee ranges starting at 1 and non-negative prices",
      );
    next = tier.max_users + 1;
  });
  if (tiers.length && tiers[tiers.length - 1].max_users !== null)
    throw new Error("Last range must have no upper limit");
  return tiers;
};
const tierRate = (record, count, cycle) => {
  const tier = parseTiers(record.pricing_tiers).find(
    (t) =>
      count >= t.min_users && (t.max_users === null || count <= t.max_users),
  );
  return tier
    ? Number(cycle === "yearly" ? tier.yearly_price : tier.price)
    : undefined;
};
module.exports = { parseTiers, validateTiers, tierRate };
