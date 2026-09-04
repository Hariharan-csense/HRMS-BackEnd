const knex = require("../db/db");

async function run() {
  try {
    console.log("Checking employees table columns...");
    const columns = await knex("employees").columnInfo();
    console.log("Current email nullable:", columns.email?.nullable);
    console.log("Current password nullable:", columns.password?.nullable);

    await knex.schema.alterTable("employees", (table) => {
      table.string("email").nullable().alter();
      table.string("password").nullable().alter();
    });

    const updatedColumns = await knex("employees").columnInfo();
    console.log("Updated email nullable:", updatedColumns.email?.nullable);
    console.log("Updated password nullable:", updatedColumns.password?.nullable);
    console.log("Migration executed successfully!");
  } catch (error) {
    console.error("Migration error:", error);
  } finally {
    await knex.destroy();
  }
}

run();
