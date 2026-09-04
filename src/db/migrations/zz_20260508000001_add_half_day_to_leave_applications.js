exports.up = async function(knex) {
  await knex.schema.alterTable('leave_applications', table => {
    table.decimal('days', 5, 2).notNullable().alter();
    table.string('half_day_session', 20).nullable().after('days');
  });
};

exports.down = async function(knex) {
  await knex.schema.alterTable('leave_applications', table => {
    table.dropColumn('half_day_session');
    table.integer('days').notNullable().alter();
  });
};
