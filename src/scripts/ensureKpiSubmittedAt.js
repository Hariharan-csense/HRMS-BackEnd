require("dotenv").config();

const knex = require("knex")({
  client: "mysql2",
  connection: {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  },
});

async function main() {
  const hasTable = await knex.schema.hasTable("kpi_parameter_reviews");
  if (!hasTable) {
    console.log("kpi_parameter_reviews table not found. Skipping.");
    return;
  }

  const hasColumn = await knex.schema.hasColumn(
    "kpi_parameter_reviews",
    "submitted_at",
  );
  if (hasColumn) {
    console.log("submitted_at already exists. Done.");
    return;
  }

  console.log("Adding submitted_at column to kpi_parameter_reviews...");
  await knex.schema.table("kpi_parameter_reviews", (table) => {
    table.timestamp("submitted_at").nullable();
  });
  console.log("submitted_at added.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await knex.destroy();
  });

