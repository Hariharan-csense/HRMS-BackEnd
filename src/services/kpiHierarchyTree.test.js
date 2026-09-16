const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildHierarchy, validateParent } = require("./kpiHierarchyTree");
const employee = (id, manager_id = null) => ({
  id,
  manager_id,
  first_name: `Employee ${id}`,
});

test("averages direct children, not all descendants, with unequal team sizes", () => {
  const employees = [
    employee(1),
    employee(2, 1),
    employee(3, 1),
    employee(4, 2),
    employee(5, 2),
    employee(6, 3),
  ];
  const result = buildHierarchy(
    employees,
    new Map([
      [4, 80],
      [5, 100],
      [6, 30],
      [1, 999],
    ]),
  );
  assert.equal(result.nodes.get(2).score, 90);
  assert.equal(result.nodes.get(1).score, 60);
  assert.equal(result.nodes.get(1).scoreType, "auto_average");
});
test("missing scores are excluded and actual zero is included", () => {
  const employees = [
    employee(1),
    employee(2, 1),
    employee(3, 1),
    employee(4, 1),
  ];
  assert.equal(
    buildHierarchy(
      employees,
      new Map([
        [2, 0],
        [3, 80],
      ]),
    ).nodes.get(1).score,
    40,
  );
  assert.equal(buildHierarchy(employees, new Map()).nodes.get(1).score, null);
});
test("child changes and clears propagate through every parent", () => {
  const employees = [employee(1), employee(2, 1), employee(3, 2)];
  for (const score of [80, 95, null]) {
    const result = buildHierarchy(employees, new Map([[3, score]]));
    assert.equal(result.nodes.get(1).score, score);
    assert.equal(result.nodes.get(2).score, score);
  }
});
test("cycles and disconnected cycles are detected", () => {
  assert.throws(
    () =>
      buildHierarchy([employee(1), employee(2, 3), employee(3, 2)], new Map()),
    /circular/,
  );
});
test("foreign or deleted parent is not followed", () => {
  const result = buildHierarchy(
    [employee(1, 999)],
    new Map([
      [1, 70],
      [999, 10],
    ]),
  );
  assert.equal(result.roots.length, 1);
  assert.equal(result.roots[0].score, 70);
});
test("rejects self, descendant, and foreign company reporting managers", () => {
  const employees = [employee(1), employee(2, 1), employee(3, 2)];
  assert.throws(() => validateParent(employees, 1, 1), /cycle/);
  assert.throws(() => validateParent(employees, 1, 3), /cycle/);
  assert.throws(() => validateParent(employees, 1, 999), /same company/);
  assert.doesNotThrow(() => validateParent(employees, 3, 1));
  assert.doesNotThrow(() => validateParent(employees, 2, null));
});
test("deep hierarchies calculate without recursive stack overflow", () => {
  const employees = Array.from({ length: 15000 }, (_, i) =>
    employee(i + 1, i || null),
  );
  assert.equal(
    buildHierarchy(employees, new Map([[15000, 87]])).nodes.get(1).score,
    87,
  );
});
test("precision is retained between hierarchy levels", () => {
  const employees = [
    employee(1),
    employee(2, 1),
    employee(3, 1),
    employee(4, 2),
    employee(5, 2),
  ];
  assert.equal(
    buildHierarchy(
      employees,
      new Map([
        [3, 1],
        [4, 0],
        [5, 0.0001],
      ]),
    ).nodes.get(1).score,
    0.500025,
  );
});
