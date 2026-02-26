exports.up = async function (knex) {
  const exists = await knex.schema.hasTable("employee_feedback");
  if (exists) return;

  await knex.schema.createTable("employee_feedback", (table) => {
    table.increments("id").primary();
    table.text("feedback").notNullable();
    table.string("category", 50).notNullable().defaultTo("general");

    table
      .integer("employeeId")
      .unsigned()
      .nullable()
      .references("id")
      .inTable("employees")
      .onDelete("SET NULL");

    table.string("employeeName", 255).nullable();
    table.string("department", 100).nullable();

    table.boolean("isAnonymous").notNullable().defaultTo(true);

    table
      .integer("companyId")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("companies")
      .onDelete("CASCADE");

    table
      .enu("status", ["submitted", "reviewed", "resolved", "dismissed"], {
        useNative: false,
      })
      .notNullable()
      .defaultTo("submitted");

    table.timestamp("createdAt").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updatedAt").nullable().defaultTo(null);

    table.index(["companyId"], "idx_company");
    table.index(["status"], "idx_status");
    table.index(["createdAt"], "idx_created");
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists("employee_feedback");
};

