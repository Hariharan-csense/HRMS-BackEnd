exports.up = function(knex) {
  return knex.schema.table('attendance', table => {
    table.integer('shift_id').unsigned().nullable();
    table.string('shift_type').nullable();
    table.foreign('shift_id').references('id').inTable('shifts');
  });
};

exports.down = function(knex) {
  return knex.schema.table('attendance', function(table) {
    table.dropForeign('shift_id');
    table.dropColumn('shift_id');
    table.dropColumn('shift_type');
  });
};
