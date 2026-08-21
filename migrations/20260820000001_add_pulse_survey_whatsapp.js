exports.up = async function (knex) {
  if (
    !(await knex.schema.hasColumn(
      "pulse_survey_templates",
      "whatsapp_template_name",
    ))
  ) {
    await knex.schema.alterTable("pulse_survey_templates", (table) => {
      table.string("whatsapp_template_name", 255).nullable();
      table.string("whatsapp_language", 16).nullable();
      table.json("whatsapp_buttons").nullable();
    });
  }
  if (!(await knex.schema.hasColumn("pulse_surveys", "pulse_template_id"))) {
    await knex.schema.alterTable("pulse_surveys", (table) => {
      table
        .integer("pulse_template_id")
        .unsigned()
        .nullable()
        .references("id")
        .inTable("pulse_survey_templates")
        .onDelete("SET NULL");
    });
  }
  if (!(await knex.schema.hasTable("pulse_survey_whatsapp_messages"))) {
    await knex.schema.createTable("pulse_survey_whatsapp_messages", (table) => {
      table.increments("id").primary();
      table
        .integer("company_id")
        .unsigned()
        .notNullable()
        .references("id")
        .inTable("companies")
        .onDelete("CASCADE");
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
        .integer("template_id")
        .unsigned()
        .nullable()
        .references("id")
        .inTable("pulse_survey_templates")
        .onDelete("SET NULL");
      table.string("ownchat_message_id", 255).nullable();
      table.string("status", 32).notNullable().defaultTo("pending");
      table.string("question", 1000).nullable();
      table.json("button_options").nullable();
      table.string("response_message_id", 255).nullable();
      table.timestamp("responded_at").nullable();
      table.timestamps(true, true);
      table.unique(["survey_id", "employee_id"]);
      table.unique(["response_message_id"]);
      table.index(["company_id", "status"]);
      table.index(["ownchat_message_id"]);
    });
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists("pulse_survey_whatsapp_messages");
};
