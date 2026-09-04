exports.up = async function (knex) {
  const hasApiKey = await knex.schema.hasColumn("companies", "essl_api_key");
  const hasEnabled = await knex.schema.hasColumn("companies", "essl_enabled");

  return knex.schema.alterTable("companies", (table) => {
    if (!hasApiKey) {
      table.string("essl_api_key").nullable();
    }

    if (!hasEnabled) {
      table.boolean("essl_enabled").notNullable().defaultTo(false);
    }
  });
};

exports.down = async function (knex) {
  const hasApiKey = await knex.schema.hasColumn("companies", "essl_api_key");
  const hasEnabled = await knex.schema.hasColumn("companies", "essl_enabled");

  return knex.schema.alterTable("companies", (table) => {
    if (hasApiKey) {
      table.dropColumn("essl_api_key");
    }

    if (hasEnabled) {
      table.dropColumn("essl_enabled");
    }
  });
};
