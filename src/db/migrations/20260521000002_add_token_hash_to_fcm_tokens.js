const crypto = require("crypto");

exports.up = async function (knex) {
  const exists = await knex.schema.hasTable("fcm_tokens");
  if (!exists) return;

  const hasTokenHash = await knex.schema.hasColumn("fcm_tokens", "token_hash");
  if (!hasTokenHash) {
    await knex.schema.alterTable("fcm_tokens", (table) => {
      table.string("token_hash", 64).nullable();
    });
  }

  const rows = await knex("fcm_tokens").select("id", "token");
  for (const row of rows) {
    if (!row.token) continue;
    const tokenHash = crypto.createHash("sha256").update(row.token).digest("hex");
    // eslint-disable-next-line no-await-in-loop
    await knex("fcm_tokens").where({ id: row.id }).update({ token_hash: tokenHash });
  }

  const indexes = await knex.raw("SHOW INDEX FROM fcm_tokens");
  const indexRows = Array.isArray(indexes) ? indexes[0] || [] : [];
  const hasTokenHashIndex = indexRows.some(
    (row) => row.Key_name === "fcm_tokens_token_hash_unique",
  );

  if (!hasTokenHashIndex) {
    await knex.schema.alterTable("fcm_tokens", (table) => {
      table.unique("token_hash", { indexName: "fcm_tokens_token_hash_unique" });
    });
  }
};

exports.down = async function (knex) {
  const exists = await knex.schema.hasTable("fcm_tokens");
  if (!exists) return;

  const hasTokenHash = await knex.schema.hasColumn("fcm_tokens", "token_hash");
  if (!hasTokenHash) return;

  await knex.schema.alterTable("fcm_tokens", (table) => {
    table.dropUnique("token_hash", "fcm_tokens_token_hash_unique");
    table.dropColumn("token_hash");
  });
};
