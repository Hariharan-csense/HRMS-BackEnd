exports.up = async function (knex) {
  const exists = await knex.schema.hasTable("hr_helpdesk_tickets");
  if (exists) return;

  await knex.schema.createTable("hr_helpdesk_tickets", (table) => {
    table.increments("id").primary();
    table.integer("company_id").unsigned().notNullable();
    table.string("ticket_number", 30).notNullable();
    table.integer("employee_id").unsigned().nullable();
    table.string("employee_name", 150).nullable();
    table.string("employee_email", 150).nullable();
    table.string("category", 60).notNullable().defaultTo("general");
    table.string("priority", 20).notNullable().defaultTo("medium");
    table.string("subject", 200).notNullable();
    table.text("description").nullable();
    table.string("status", 30).notNullable().defaultTo("open");
    table.integer("assigned_hr_id").unsigned().nullable();
    table.string("assigned_hr_name", 150).nullable();
    table.integer("sla_hours").unsigned().notNullable().defaultTo(72);
    table.timestamp("due_at").nullable();
    table.timestamp("resolved_at").nullable();
    table.text("resolution_notes").nullable();
    table.integer("created_by").unsigned().nullable();
    table.integer("updated_by").unsigned().nullable();
    table.timestamps(true, true);

    table.unique(["company_id", "ticket_number"]);
    table.index(["company_id", "employee_id"]);
    table.index(["company_id", "status"]);
    table.index(["company_id", "category"]);
    table.index(["company_id", "due_at"]);
  });
};

exports.down = async function (knex) {
  const exists = await knex.schema.hasTable("hr_helpdesk_tickets");
  if (exists) {
    await knex.schema.dropTable("hr_helpdesk_tickets");
  }
};
