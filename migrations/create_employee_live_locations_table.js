exports.up = function(knex) {
  return knex.schema.createTable('employee_live_locations', function(table) {
    table.increments('id').primary();
    
    // Employee reference with company isolation
    table.integer('employee_id').unsigned().notNullable();
    table.foreign('employee_id').references('id').inTable('employees').onDelete('CASCADE');
    
    // Company isolation
    table.integer('company_id').unsigned().notNullable();
    table.foreign('company_id').references('id').inTable('companies').onDelete('CASCADE');
    
    // Location data
    table.decimal('latitude', 10, 8).notNullable();
    table.decimal('longitude', 11, 8).notNullable();
    table.decimal('accuracy', 8, 2).nullable(); // GPS accuracy in meters
    
    // Address information
    table.string('address').nullable();
    table.json('location_data').nullable(); // Additional location metadata
    
    // Tracking status
    table.boolean('is_tracking').defaultTo(true); // Whether employee is currently being tracked
    table.string('tracking_status').defaultTo('active'); // active, paused, offline
    
    // Device and session info
    table.string('device_info').nullable();
    table.string('session_id').nullable();
    
    // Timestamps
    table.timestamp('location_timestamp').defaultTo(knex.fn.now());
    table.timestamp('last_updated').defaultTo(knex.fn.now());
    
    // Indexes for performance
    table.index(['employee_id', 'company_id']);
    table.index(['company_id', 'is_tracking']);
    table.index(['location_timestamp']);
    
    // Unique constraint to prevent duplicate entries for same employee at same time
    table.unique(['employee_id', 'location_timestamp'], {
      useConstraint: true,
      deferrable: 'deferred'
    });
  });
};

exports.down = function(knex) {
  return knex.schema.dropTable('employee_live_locations');
};
