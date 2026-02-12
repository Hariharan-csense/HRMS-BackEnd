exports.up = function(knex) {
  return knex.schema.createTable('notifications', function(table) {
    table.string('id').primary().defaultTo(knex.raw('UUID()'));
    table.string('user_id').notNullable();
    table.string('title').notNullable();
    table.text('description').notNullable();
    table.enum('type', ['success', 'warning', 'info', 'error']).defaultTo('info');
    table.boolean('read').defaultTo(false);
    table.string('module_id').nullable();
    table.string('action_url').nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
    
    table.index(['user_id', 'read']);
    table.index(['created_at']);
  });
};

exports.down = function(knex) {
  return knex.schema.dropTable('notifications');
};
