// Additive migration: existing scorecards and reporting relationships are preserved.
exports.up = async function (knex) {
  if (!(await knex.schema.hasColumn("employees", "manager_id"))) {
    await knex.schema.alterTable("employees", (t) => {
      t.integer("manager_id")
        .unsigned()
        .nullable()
        .references("id")
        .inTable("employees")
        .onDelete("SET NULL");
    });
  }
  const [indexes] = await knex.raw("SHOW INDEX FROM employees");
  if (!indexes.some((i) => i.Key_name === "idx_employees_company_manager")) {
    await knex.schema.alterTable("employees", (t) => {
      t.index(["company_id", "manager_id"], "idx_employees_company_manager");
    });
  }
  await knex.schema.createTable("kpi_hierarchy_scores", (t) => {
    t.increments("id");
    t.integer("company_id").unsigned().notNullable();
    t.integer("employee_id")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("employees")
      .onDelete("CASCADE");
    t.integer("kpi_template_id")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("kpi_templates")
      .onDelete("CASCADE");
    t.integer("kpi_parameter_id")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("kpi_parameters")
      .onDelete("CASCADE");
    t.integer("year").unsigned().notNullable();
    t.integer("month").unsigned().notNullable();
    t.decimal("score", 12, 4).nullable();
    t.timestamps(true, true);
    t.unique(
      [
        "company_id",
        "kpi_template_id",
        "year",
        "month",
        "employee_id",
        "kpi_parameter_id",
      ],
      "uq_kpi_hierarchy_period",
    );
    t.index(
      ["company_id", "employee_id", "year", "month"],
      "idx_kpi_hierarchy_employee_period",
    );
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists("kpi_hierarchy_scores");
  await knex.schema.alterTable("employees", (t) => {
    t.dropIndex([], "idx_employees_company_manager");
  });
  // manager_id may predate this migration; never remove reporting relationships.
};
