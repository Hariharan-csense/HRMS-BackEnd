exports.up = async function (knex) {
  const hasEmployees = await knex.schema.hasTable("employees");
  if (!hasEmployees) return;

  await knex.schema.alterTable("employees", (table) => {
    table.string("email").nullable().alter();
    table.string("password").nullable().alter();
  });
};

exports.down = async function (knex) {
  const hasEmployees = await knex.schema.hasTable("employees");
  if (!hasEmployees) return;

  await knex.schema.alterTable("employees", (table) => {
    table.string("email").notNullable().alter();
    table.string("password").notNullable().alter();
  });
};
