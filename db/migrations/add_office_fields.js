exports.up = function(knex) {
  return knex.schema
    .alterTable('employees', function(table) {
      table.string('office_phone', 20).nullable().after('mobile');
      table.string('office_email', 255).nullable().after('office_phone');
    });
};

exports.down = function(knex) {
  return knex.schema
    .alterTable('employees', function(table) {
      table.dropColumn('office_phone');
      table.dropColumn('office_email');
    });
};
