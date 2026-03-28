exports.up = function(knex) {
  return knex.schema.createTable('attendance', function(table) {
    table.increments('id').primary();
    
    // Correct foreign key
    table.integer('employee_id').unsigned().notNullable();
    table.foreign('employee_id').references('id').inTable('employees').onDelete('CASCADE');
    
    table.timestamp('check_in').nullable();
    table.timestamp('check_out').nullable();
    
    table.json('check_in_location').nullable();
    table.json('check_out_location').nullable();
    
    table.string('check_in_image_url').nullable();
    table.string('check_out_image_url').nullable();
    
    table.decimal('hours_worked', 5, 2).defaultTo(0);
    table.decimal('overtime_hours', 5, 2).defaultTo(0);
    
    table.string('status').defaultTo('present');
    
    table.string('device_info').nullable();
    table.boolean('auto_flag').defaultTo(false);
    table.string('flag_reason').nullable();
    
    table.timestamps(true, true);
  });
};

exports.down = function(knex) {
  return knex.schema.dropTable('attendance');
};