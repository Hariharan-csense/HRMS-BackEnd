exports.up = function(knex) {
  return knex.schema.table('employees', table => {
    table.integer('shift_id').unsigned().nullable();
    table.foreign('shift_id').references('id').inTable('shifts');
  });
};

exports.down = function(knex) {
  return knex.schema.table('employees', function(table) {
    table.dropForeign('shift_id');
    table.dropColumn('shift_id');
  });
};
