exports.up = async function (knex) {
  let createdKpiTemplates = false;
  let createdKpiParameters = false;
  let createdKpiParameterReviews = false;
  let createdEmployeeKpi = false;

  const hasKpiTemplates = await knex.schema.hasTable("kpi_templates");
  if (!hasKpiTemplates) {
    await knex.schema.createTable("kpi_templates", function (table) {
      table.increments("id").primary();
      table.integer("company_id").unsigned().nullable();
      table.integer("owner_employee_id").unsigned().nullable();
      table.integer("role_id").unsigned().nullable();
      table.integer("department_id").unsigned().nullable();
      table.integer("designation_id").unsigned().nullable();
      table.string("title").nullable();
      table.text("description").nullable();
      table.enu("frequency", ["DAILY", "WEEKLY", "MONTHLY"]).notNullable().defaultTo("MONTHLY");
      table.decimal("weight", 8, 2).notNullable().defaultTo(100);
      table.decimal("total_score", 8, 2).notNullable().defaultTo(0);
      table.boolean("is_previous_month_fallback").notNullable().defaultTo(false);
      table.timestamps(true, true);

      table.index(["company_id", "owner_employee_id"], "idx_kpi_templates_company_owner");
      table.index(["department_id"], "idx_kpi_templates_department");
      table.index(["created_at"], "idx_kpi_templates_created_at");
    });
    createdKpiTemplates = true;
  }

  const hasKpiParameters = await knex.schema.hasTable("kpi_parameters");
  if (!hasKpiParameters) {
    await knex.schema.createTable("kpi_parameters", function (table) {
      table.increments("id").primary();
      table.integer("kpi_template_id").unsigned().notNullable();
      table.string("name").notNullable();
      table.string("uom").nullable();
      table.decimal("reference", 12, 2).nullable();
      table.decimal("commitment", 12, 2).nullable();
      table.decimal("weightage", 8, 2).nullable();
      table.decimal("achievement", 12, 2).nullable();
      table.decimal("kpi_score", 8, 2).nullable();
      table.json("daily_achievements").nullable();
      table.text("kpi_definition").nullable();
      table.text("measurement_method").nullable();
      table.text("data_source").nullable();
      table.text("lead_indicators").nullable();
      table.timestamps(true, true);

      table.index(["kpi_template_id"], "idx_kpi_parameters_template");
    });
    createdKpiParameters = true;
  }

  const hasKpiParameterReviews = await knex.schema.hasTable("kpi_parameter_reviews");
  if (!hasKpiParameterReviews) {
    await knex.schema.createTable("kpi_parameter_reviews", function (table) {
      table.increments("id").primary();
      table.integer("kpi_template_id").unsigned().notNullable();
      table.integer("kpi_parameter_id").unsigned().nullable();
      table.integer("reviewer_employee_id").unsigned().nullable();
      table.text("what_went_wrong").nullable();
      table.text("lesson_learned").nullable();
      table.text("corrective_actions").nullable();
      table.text("feedback").nullable();
      table.date("target_date").nullable();
      table.enu("status", ["PENDING", "IN_PROGRESS", "COMPLETED"]).notNullable().defaultTo("PENDING");
      table.timestamps(true, true);

      table.index(["kpi_template_id"], "idx_kpi_reviews_template");
      table.index(["kpi_parameter_id"], "idx_kpi_reviews_parameter");
      table.index(["status"], "idx_kpi_reviews_status");
    });
    createdKpiParameterReviews = true;
  }

  const hasEmployeeKpi = await knex.schema.hasTable("employee_kpi");
  if (!hasEmployeeKpi) {
    await knex.schema.createTable("employee_kpi", function (table) {
      table.increments("id").primary();
      table.integer("employee_id").unsigned().notNullable();
      table.integer("kpi_template_id").unsigned().nullable();
      table.string("title").nullable();
      table.enu("status", ["PENDING", "IN_PROGRESS", "COMPLETED"]).notNullable().defaultTo("PENDING");
      table.decimal("score", 8, 2).nullable();
      table.timestamps(true, true);

      table.index(["employee_id"], "idx_employee_kpi_employee");
      table.index(["kpi_template_id"], "idx_employee_kpi_template");
      table.index(["status"], "idx_employee_kpi_status");
    });
    createdEmployeeKpi = true;
  }

  await addForeignKeys(knex, {
    createdKpiTemplates,
    createdKpiParameters,
    createdKpiParameterReviews,
    createdEmployeeKpi,
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists("employee_kpi");
  await knex.schema.dropTableIfExists("kpi_parameter_reviews");
  await knex.schema.dropTableIfExists("kpi_parameters");
  await knex.schema.dropTableIfExists("kpi_templates");
};

async function addForeignKeys(knex, createdTables) {
  const hasCompanies = await knex.schema.hasTable("companies");
  const hasEmployees = await knex.schema.hasTable("employees");
  const hasRoles = await knex.schema.hasTable("roles");
  const hasDepartments = await knex.schema.hasTable("departments");
  const hasDesignations = await knex.schema.hasTable("designations");

  if (
    createdTables.createdKpiTemplates &&
    (hasCompanies || hasEmployees || hasRoles || hasDepartments || hasDesignations)
  ) {
    await knex.schema.table("kpi_templates", function (table) {
      if (hasCompanies) {
        table.foreign("company_id").references("id").inTable("companies").onDelete("CASCADE");
      }
      if (hasEmployees) {
        table.foreign("owner_employee_id").references("id").inTable("employees").onDelete("SET NULL");
      }
      if (hasRoles) {
        table.foreign("role_id").references("id").inTable("roles").onDelete("SET NULL");
      }
      if (hasDepartments) {
        table.foreign("department_id").references("id").inTable("departments").onDelete("SET NULL");
      }
      if (hasDesignations) {
        table.foreign("designation_id").references("id").inTable("designations").onDelete("SET NULL");
      }
    });
  }

  if (createdTables.createdKpiParameters) {
    await knex.schema.table("kpi_parameters", function (table) {
      table.foreign("kpi_template_id").references("id").inTable("kpi_templates").onDelete("CASCADE");
    });
  }

  if (createdTables.createdKpiParameterReviews) {
    await knex.schema.table("kpi_parameter_reviews", function (table) {
      table.foreign("kpi_template_id").references("id").inTable("kpi_templates").onDelete("CASCADE");
      table.foreign("kpi_parameter_id").references("id").inTable("kpi_parameters").onDelete("CASCADE");
      if (hasEmployees) {
        table.foreign("reviewer_employee_id").references("id").inTable("employees").onDelete("SET NULL");
      }
    });
  }

  if (createdTables.createdEmployeeKpi) {
    await knex.schema.table("employee_kpi", function (table) {
      if (hasEmployees) {
        table.foreign("employee_id").references("id").inTable("employees").onDelete("CASCADE");
      }
      table.foreign("kpi_template_id").references("id").inTable("kpi_templates").onDelete("SET NULL");
    });
  }
}
