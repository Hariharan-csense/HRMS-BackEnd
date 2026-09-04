exports.up = async function up(knex) {
  const hasFiscalYear = await knex.schema.hasTable("fiscal_year");
  if (!hasFiscalYear) {
    await knex.schema.createTable("fiscal_year", (table) => {
      table.increments("id").primary();
      table.integer("company_id").unsigned().notNullable();
      table.string("year", 20).notNullable();
      table.date("start_date").notNullable();
      table.date("end_date").notNullable();
      table.date("leave_cycle_start").nullable();
      table.boolean("is_active").defaultTo(false);
      table.timestamps(true, true);
      table.index(["company_id", "is_active"]);
      table.index(["company_id", "start_date", "end_date"]);
    });
  }

  if (await knex.schema.hasTable("leave_balances")) {
    const hasTotal = await knex.schema.hasColumn("leave_balances", "total");
    await knex.schema.alterTable("leave_balances", (table) => {
      table.decimal("opening_balance", 8, 2).notNullable().alter();
      table.decimal("availed", 8, 2).notNullable().defaultTo(0).alter();
      table.decimal("available", 8, 2).notNullable().alter();
      if (hasTotal) {
        table.decimal("total", 8, 2).nullable().alter();
      }
    });
  }

  if (await knex.schema.hasTable("leave_applications")) {
    await knex.schema.alterTable("leave_applications", (table) => {
      table.decimal("days", 8, 2).notNullable().alter();
    });

    const hasHalfDaySession = await knex.schema.hasColumn(
      "leave_applications",
      "half_day_session",
    );
    if (!hasHalfDaySession) {
      await knex.schema.alterTable("leave_applications", (table) => {
        table.string("half_day_session", 30).nullable();
      });
    }
  }
};

exports.down = async function down(knex) {
  if (await knex.schema.hasTable("leave_applications")) {
    const hasHalfDaySession = await knex.schema.hasColumn(
      "leave_applications",
      "half_day_session",
    );
    if (hasHalfDaySession) {
      await knex.schema.alterTable("leave_applications", (table) => {
        table.dropColumn("half_day_session");
      });
    }
  }
};
