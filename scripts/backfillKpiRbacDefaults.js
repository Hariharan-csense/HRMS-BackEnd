const knex = require("../db/db");
const {
  getDefaultModulesForRoleName,
  mergeDefaultModulesForRoleName,
} = require("../config/rbacDefaults");
const {
  normalizeModulesPayload,
  parseModulesFromDb,
} = require("../utils/rbac");

const DEFAULT_ROLE_NAMES = ["admin", "ceo", "employee"];

const run = async () => {
  const roleColumns = await knex("roles").columnInfo();
  const roles = await knex("roles")
    .select("id", "name", "modules")
    .whereIn(
      knex.raw("LOWER(name)"),
      DEFAULT_ROLE_NAMES,
    );

  let updatedCount = 0;

  for (const role of roles) {
    const defaultModules = getDefaultModulesForRoleName(role.name);
    if (!defaultModules) continue;

    const currentModules = parseModulesFromDb(role.modules);
    const mergedModules = normalizeModulesPayload(
      mergeDefaultModulesForRoleName(role.name, currentModules),
    );

    if (JSON.stringify(currentModules) === JSON.stringify(mergedModules)) {
      continue;
    }

    await knex("roles")
      .where({ id: role.id })
      .update({
        modules: JSON.stringify(mergedModules),
        ...(roleColumns.use_new_rbac ? { use_new_rbac: true } : {}),
        ...(roleColumns.updated_at ? { updated_at: knex.fn.now() } : {}),
      });

    updatedCount += 1;
    console.log(`Updated RBAC defaults for ${role.name} (${role.id})`);
  }

  console.log(`RBAC default role backfill complete. Updated ${updatedCount} role(s).`);
};

run()
  .catch((error) => {
    console.error("RBAC default role backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await knex.destroy();
  });
