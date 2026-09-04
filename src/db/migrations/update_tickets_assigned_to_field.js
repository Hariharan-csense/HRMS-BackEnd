// migrations/update_tickets_assigned_to_field.js
exports.up = function(knex) {
  return knex.schema.alterTable('tickets', function(table) {
    // Drop the foreign key constraint first
    table.dropForeign('assigned_to');
    
    // Change the column type from integer to string
    table.string('assigned_to').nullable().alter();
  });
};

exports.down = function(knex) {
  return knex.schema.alterTable('tickets', function(table) {
    // Revert back to integer
    table.integer('assigned_to').unsigned().nullable().alter();
    
    // Re-add the foreign key constraint
    table.foreign('assigned_to').references('id').inTable('users').onDelete('SET NULL');
  });
};
