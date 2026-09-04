exports.up = function(knex) {
  return knex.schema.alterTable('leave_balances', table => {
    // Add total field to store the total leave days (same as opening_balance initially)
    table.integer('total').after('opening_balance');
  });
};

exports.down = function(knex) {
  return knex.schema.alterTable('leave_balances', table => {
    table.dropColumn('total');
  });
};
