exports.up = async function(knex) {
  const exists = await knex.schema.hasTable('face_templates');
  if (exists) return;

  await knex.schema.createTable('face_templates', function(table) {
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

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('face_templates');
};
