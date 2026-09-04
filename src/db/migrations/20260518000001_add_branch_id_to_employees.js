exports.up = function (knex) {
  return knex.schema.table("employees", function (table) {
    table.integer("branch_id").unsigned().nullable();
    table.foreign("branch_id").references("id").inTable("branches");
  });
};

exports.down = function (knex) {
  return knex.schema.table("employees", function (table) {
    table.dropForeign("branch_id");
    table.dropColumn("branch_id");
  });
};
