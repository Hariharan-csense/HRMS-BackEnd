exports.up = function(knex) {
  return knex.schema.alterTable('tickets', table => {
    table.integer('company_id').unsigned().nullable().after('id');
    table.foreign('company_id').references('id').inTable('companies').onDelete('SET NULL');
  });
};

exports.down = function(knex) {
  return knex.schema.alterTable('tickets', table => {
    table.dropForeign('company_id');
    table.dropColumn('company_id');
  });
};
