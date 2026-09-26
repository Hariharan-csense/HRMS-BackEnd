const { test } = require("node:test");
const assert = require("node:assert/strict");
const { validateTiers, tierRate } = require("./subscriptionTiers");
const tiers = [
  { min_users: 1, max_users: 49, price: 90, yearly_price: 80 },
  { min_users: 50, max_users: 100, price: 70, yearly_price: 60 },
  { min_users: 101, max_users: null, price: 50, yearly_price: 0 },
];
test("tier boundaries and annual zero prices", () => {
  assert.deepEqual(validateTiers(tiers), tiers);
  for (const [count, price] of [
    [1, 90],
    [49, 90],
    [50, 70],
    [100, 70],
    [101, 50],
    [10000, 50],
  ]) {
    assert.equal(
      tierRate({ pricing_tiers: JSON.stringify(tiers) }, count, "monthly"),
      price,
    );
  }
  assert.equal(tierRate({ pricing_tiers: tiers }, 101, "yearly"), 0);
  assert.equal(tierRate({}, 50, "monthly"), undefined);
});
test("reject gaps, overlaps, negative rates and closed final ranges", () => {
  for (const invalid of [
    [{ ...tiers[0], min_users: 2 }, ...tiers.slice(1)],
    [tiers[0], { ...tiers[1], min_users: 49 }, tiers[2]],
    [tiers[0], { ...tiers[1], price: -1 }, tiers[2]],
    [tiers[0], { ...tiers[1], price: null }, tiers[2]],
    tiers.slice(0, 2),
  ])
    assert.throws(() => validateTiers(invalid));
});
