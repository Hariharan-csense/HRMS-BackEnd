// migrations/create_tickets_table.js
exports.up = function(knex) {
  return knex.schema.createTable('tickets', function(table) {
    table.increments('id').primary();
    table.string('ticket_number').unique().notNullable();
    table.string('title').notNullable();
    table.text('description').notNullable();
    table.enum('priority', ['low', 'medium', 'high', 'urgent']).defaultTo('medium');
    table.enum('category', ['technical', 'hr', 'finance', 'operations', 'general']).defaultTo('general');
    table.enum('status', ['open', 'in_progress', 'resolved', 'closed']).defaultTo('open');
    table.integer('assigned_to').unsigned().nullable();
    table.integer('created_by').unsigned().notNullable();
    table.timestamps(true, true);

    // Foreign key constraints
    table.foreign('assigned_to').references('id').inTable('users').onDelete('SET NULL');
    table.foreign('created_by').references('id').inTable('users').onDelete('CASCADE');

    // Indexes for better performance
    table.index('ticket_number');
    table.index('status');
    table.index('priority');
    table.index('category');
    table.index('created_by');
    table.index('assigned_to');
  });
};

exports.down = function(knex) {
  return knex.schema.dropTable('tickets');
};
