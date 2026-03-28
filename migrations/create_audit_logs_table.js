exports.up = function(knex) {
  return knex.schema.createTable('audit_logs', table => {
    table.increments('id').primary();
    table.string('action').notNullable(); // create, update, delete, login, etc.
    table.string('table_name').nullable();
    table.bigInteger('record_id').nullable();
    
    // Correct foreign key
    table.integer('performed_by').unsigned().notNullable();
    table.foreign('performed_by').references('id').inTable('users').onDelete('SET NULL');
    
    table.json('old_values').nullable();
    table.json('new_values').nullable();
    table.timestamp('performed_at').defaultTo(knex.fn.now());
    table.timestamps(true, true);
  });
};

exports.down = function(knex) {
  return knex.schema.dropTable('audit_logs');
};