// db/migrations/xxxx_create_client_attendance_table.js
exports.up = function(knex) {
  return knex.schema.createTable('client_attendance', table => {
    table.increments('id').primary();
    table.integer('employee_id').unsigned().references('id').inTable('employees').onDelete('CASCADE');
    table.integer('client_id').unsigned().references('id').inTable('clients').onDelete('CASCADE');
    table.date('date').notNullable();
    
    // Check-in details
    table.datetime('check_in_time').notNullable();
    table.decimal('check_in_latitude', 10, 8);
    table.decimal('check_in_longitude', 11, 8);
    table.string('check_in_location');
    table.text('check_in_notes');
    
    // Check-out details
    table.datetime('check_out_time');
    table.decimal('check_out_latitude', 10, 8);
    table.decimal('check_out_longitude', 11, 8);
    table.string('check_out_location');
    table.text('check_out_notes');
    table.text('work_completed');
    
    // Calculated duration in minutes
    table.integer('duration_minutes');
    
    table.timestamps(true, true);
    
    // Ensure unique check-in per employee per client per day
    table.unique(['employee_id', 'client_id', 'date']);
  });
};

exports.down = function(knex) {
  return knex.schema.dropTable('client_attendance');
};
