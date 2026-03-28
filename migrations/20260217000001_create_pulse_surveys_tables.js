exports.up = async function (knex) {
  const hasPulseSurveys = await knex.schema.hasTable("pulse_surveys");
  if (!hasPulseSurveys) {
    await knex.schema.createTable("pulse_surveys", (table) => {
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

      table.string("title", 255).notNullable();
      table.text("message").nullable();
      table
        .enu("recipient_type", ["all", "department", "designation", "employee"], {
          useNative: false,
        })
        .notNullable()
        .defaultTo("all");
      table.boolean("allow_anonymous").notNullable().defaultTo(false);
      table
        .enu("status", ["pending", "sent", "closed"], { useNative: false })
        .notNullable()
        .defaultTo("sent");
      table.integer("total_sent").notNullable().defaultTo(0);
      table.timestamps(true, true);
    });
  }

  const hasRecipients = await knex.schema.hasTable("pulse_survey_recipients");
  if (!hasRecipients) {
    await knex.schema.createTable("pulse_survey_recipients", (table) => {
      table.increments("id").primary();
      table
        .integer("survey_id")
        .unsigned()
        .notNullable()
        .references("id")
        .inTable("pulse_surveys")
        .onDelete("CASCADE");
      table
        .integer("employee_id")
        .unsigned()
        .notNullable()
        .references("id")
        .inTable("employees")
        .onDelete("CASCADE");
      table
        .integer("company_id")
        .unsigned()
        .notNullable()
        .references("id")
        .inTable("companies")
        .onDelete("CASCADE");
      table.timestamp("sent_at").notNullable().defaultTo(knex.fn.now());

      table.unique(["survey_id", "employee_id"]);
      table.index(["employee_id", "company_id"]);
    });
  }

  const hasResponses = await knex.schema.hasTable("pulse_survey_responses");
  if (!hasResponses) {
    await knex.schema.createTable("pulse_survey_responses", (table) => {
      table.increments("id").primary();
      table
        .integer("survey_id")
        .unsigned()
        .notNullable()
        .references("id")
        .inTable("pulse_surveys")
        .onDelete("CASCADE");
      table
        .integer("employee_id")
        .unsigned()
        .notNullable()
        .references("id")
        .inTable("employees")
        .onDelete("CASCADE");
      table
        .integer("company_id")
        .unsigned()
        .notNullable()
        .references("id")
        .inTable("companies")
        .onDelete("CASCADE");

      table.integer("score").notNullable();
      table.string("label", 64).notNullable().defaultTo("");
      table.text("comment").nullable();
      table.boolean("is_anonymous").notNullable().defaultTo(false);

      table.timestamp("responded_at").notNullable().defaultTo(knex.fn.now());
      table.timestamps(true, true);

      table.unique(["survey_id", "employee_id"]);
      table.index(["survey_id", "company_id"]);
    });
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists("pulse_survey_responses");
  await knex.schema.dropTableIfExists("pulse_survey_recipients");
  await knex.schema.dropTableIfExists("pulse_surveys");
};

