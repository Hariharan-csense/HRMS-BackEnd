exports.up = function(knex) {
  return knex.schema.alterTable('employees', table => {
    table.boolean('is_password_temporary').defaultTo(true).after('password');
  });
};

exports.down = function(knex) {
  return knex.schema.alterTable('employees', table => {
    table.dropColumn('is_password_temporary');
  });
};
