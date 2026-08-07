exports.up = async function(knex) {
  const hasCompanyPolicies = await knex.schema.hasTable("company_policies");
  if (hasCompanyPolicies) {
    const hasLoanPolicy = await knex.schema.hasColumn(
      "company_policies",
      "loan_policy",
    );
    if (!hasLoanPolicy) {
      await knex.schema.alterTable("company_policies", (table) => {
        table.text("loan_policy").nullable();
      });
    }
  }

  const hasLoanRequests = await knex.schema.hasTable("loan_requests");
  if (!hasLoanRequests) {
    await knex.schema.createTable("loan_requests", (table) => {
      table.increments("id").primary();
      table.integer("company_id").unsigned().notNullable();
      table.string("request_no", 30).notNullable();
      table.integer("employee_id").unsigned().notNullable();
      table.string("employee_code", 80).nullable();
      table.string("employee_name", 180).nullable();
      table.string("department_name", 180).nullable();
      table.enu("request_type", ["loan", "advance"]).notNullable().defaultTo("loan");
      table.decimal("amount", 12, 2).notNullable();
      table.integer("tenure_months").unsigned().notNullable();
      table.decimal("emi_amount", 12, 2).notNullable();
      table.string("recovery_start_month", 7).notNullable();
      table.date("request_date").notNullable();
      table.text("purpose").nullable();
      table
        .enu("status", ["pending", "approved", "rejected", "disbursed", "closed"])
        .notNullable()
        .defaultTo("pending");
      table.integer("paid_installments").unsigned().notNullable().defaultTo(0);
      table.integer("remaining_installments").unsigned().notNullable();
      table.decimal("paid_amount", 12, 2).notNullable().defaultTo(0);
      table.decimal("balance_amount", 12, 2).notNullable();
      table.integer("approved_by").unsigned().nullable();
      table.timestamp("approved_at").nullable();
      table.text("approval_remarks").nullable();
      table.timestamps(true, true);

      table.unique(["company_id", "request_no"]);
      table.index(["company_id", "employee_id", "status"]);
      table.index(["company_id", "request_date"]);
      table
        .foreign("company_id")
        .references("id")
        .inTable("companies")
        .onDelete("CASCADE");
      table
        .foreign("employee_id")
        .references("id")
        .inTable("employees")
        .onDelete("CASCADE");
    });
  }

  const hasLoanRepayments = await knex.schema.hasTable("loan_repayments");
  if (!hasLoanRepayments) {
    await knex.schema.createTable("loan_repayments", (table) => {
      table.increments("id").primary();
      table.integer("company_id").unsigned().notNullable();
      table.integer("loan_request_id").unsigned().notNullable();
      table.integer("employee_id").unsigned().notNullable();
      table.string("payroll_month", 7).nullable();
      table.date("paid_on").notNullable();
      table.decimal("amount", 12, 2).notNullable();
      table.text("remarks").nullable();
      table.integer("created_by").unsigned().nullable();
      table.timestamps(true, true);

      table.index(["company_id", "loan_request_id"]);
      table.index(["company_id", "employee_id"]);
      table
        .foreign("company_id")
        .references("id")
        .inTable("companies")
        .onDelete("CASCADE");
      table
        .foreign("loan_request_id")
        .references("id")
        .inTable("loan_requests")
        .onDelete("CASCADE");
      table
        .foreign("employee_id")
        .references("id")
        .inTable("employees")
        .onDelete("CASCADE");
    });
  }
};

exports.down = async function(knex) {
  const hasLoanRepayments = await knex.schema.hasTable("loan_repayments");
  if (hasLoanRepayments) {
    await knex.schema.dropTable("loan_repayments");
  }

  const hasLoanRequests = await knex.schema.hasTable("loan_requests");
  if (hasLoanRequests) {
    await knex.schema.dropTable("loan_requests");
  }

  const hasCompanyPolicies = await knex.schema.hasTable("company_policies");
  if (hasCompanyPolicies) {
    const hasLoanPolicy = await knex.schema.hasColumn(
      "company_policies",
      "loan_policy",
    );
    if (hasLoanPolicy) {
      await knex.schema.alterTable("company_policies", (table) => {
        table.dropColumn("loan_policy");
      });
    }
  }
};
