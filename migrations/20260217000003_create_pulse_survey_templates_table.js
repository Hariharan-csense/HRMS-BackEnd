exports.up = async function (knex) {
  const exists = await knex.schema.hasTable("pulse_survey_templates");
  if (exists) return;

  await knex.schema.createTable("pulse_survey_templates", (table) => {
    table.increments("id").primary();

    table
      .integer("company_id")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("companies")
      .onDelete("CASCADE");

    table
      .integer("created_by_user_id")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("users")
      .onDelete("CASCADE");

    table.string("name", 120).notNullable();
    table.string("title", 255).notNullable();
    table.text("message").nullable();
    table.string("category", 50).notNullable().defaultTo("general");
    table.boolean("is_active").notNullable().defaultTo(true);

    table.timestamps(true, true);

    table.unique(["company_id", "name"]);
    table.index(["company_id", "is_active"]);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists("pulse_survey_templates");
};

