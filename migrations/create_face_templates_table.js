exports.up = function(knex) {
  return knex.schema.createTable('face_templates', function(table) {
    table.increments('id').primary();
    table.integer('employee_id').unsigned().notNullable().references('id').inTable('employees');
    table.text('template_hash').notNullable();
    table.string('device_used').nullable();
    table.boolean('is_active').defaultTo(true);
    table.timestamps(true, true);
    
    // Add index for faster lookups
    table.index(['employee_id', 'is_active']);
  });
};

exports.down = function(knex) {
  return knex.schema.dropTable('face_templates');
};
