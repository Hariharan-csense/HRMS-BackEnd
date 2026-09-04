exports.up = function(knex) {
  return knex.schema.alterTable('employees', table => {
    table.integer('company_id').unsigned().notNullable().after('id');
    table.foreign('company_id').references('id').inTable('companies');
  });
};

exports.down = function(knex) {
  return knex.schema.alterTable('employees', table => {
    table.dropForeign('company_id');
    table.dropColumn('company_id');
  });
};
