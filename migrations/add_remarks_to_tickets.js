// migrations/add_remarks_to_tickets.js
exports.up = function(knex) {
  return knex.schema.alterTable('tickets', function(table) {
    table.text('remarks').nullable().after('description');
  });
};

exports.down = function(knex) {
  return knex.schema.alterTable('tickets', function(table) {
    table.dropColumn('remarks');
  });
};
