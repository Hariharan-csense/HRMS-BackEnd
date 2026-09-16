const fail = (message, status = 400) =>
  Object.assign(new Error(message), { status });

function validateParent(employees, employeeId, parentId) {
  const byId = new Map(employees.map((e) => [Number(e.id), e]));
  if (!byId.has(employeeId)) throw fail("Employee not found.", 404);
  const seen = new Set([employeeId]);
  let cursor = parentId;
  while (cursor !== null) {
    if (seen.has(cursor))
      throw fail("Reporting relationships cannot contain a cycle.");
    seen.add(cursor);
    const parent = byId.get(cursor);
    if (!parent)
      throw fail("Reporting manager must belong to the same company.");
    cursor = parent.manager_id == null ? null : Number(parent.manager_id);
  }
}

// Iterative postorder supports deep hierarchies without recursive call-stack limits.
function buildHierarchy(employees, scores) {
  const nodes = new Map(
    employees.map((e) => [
      Number(e.id),
      {
        id: Number(e.id),
        name: `${e.first_name || ""} ${e.last_name || ""}`.trim(),
        designation: e.designation || "",
        department: e.department || "",
        branch: e.branch || "",
        departmentId: e.department_id,
        branchId: e.branch_id,
        parentEmployeeId: e.manager_id == null ? null : Number(e.manager_id),
        score: null,
        scoreType: "manual",
        children: [],
      },
    ]),
  );
  const roots = [];
  for (const node of nodes.values()) {
    const parent = nodes.get(node.parentEmployeeId);
    // Orphaned or foreign-tenant historical links are never followed.
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const remaining = new Map(
    [...nodes.values()].map((n) => [n.id, n.children.length]),
  );
  const queue = [...nodes.values()].filter((n) => !n.children.length);
  let visited = 0;
  for (let i = 0; i < queue.length; i++) {
    const node = queue[i];
    visited++;
    if (node.children.length) {
      node.scoreType = "auto_average";
      const available = node.children.filter((c) => c.score !== null);
      node.score = available.length
        ? available.reduce((sum, c) => sum + c.score, 0) / available.length
        : null;
    } else {
      const value = scores.get(node.id);
      node.score = value == null ? null : Number(value);
    }
    const parent = nodes.get(node.parentEmployeeId);
    if (parent) {
      remaining.set(parent.id, remaining.get(parent.id) - 1);
      if (!remaining.get(parent.id)) queue.push(parent);
    }
  }
  if (visited !== nodes.size)
    throw fail(
      "A circular reporting relationship exists. Correct the reporting managers first.",
      409,
    );
  return { roots, nodes };
}

module.exports = { buildHierarchy, validateParent, fail };
