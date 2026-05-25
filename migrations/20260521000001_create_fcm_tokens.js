exports.up = async function (knex) {
  const exists = await knex.schema.hasTable("fcm_tokens");
  if (exists) return;

  await knex.schema.createTable("fcm_tokens", (table) => {
    table.increments("id").primary();
    table.string("user_id", 64).notNullable();
    table.integer("company_id").unsigned().nullable();
    table.text("token").notNullable();
    table.string("token_hash", 64).notNullable();
    table.string("platform", 32).notNullable().defaultTo("web");
    table.string("user_agent", 512).nullable();
    table.boolean("active").notNullable().defaultTo(true);
    table.timestamps(true, true);

    table.unique("token_hash", { indexName: "fcm_tokens_token_hash_unique" });
    table.index(["user_id", "active"]);
    table.index(["company_id", "active"]);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists("fcm_tokens");
};
