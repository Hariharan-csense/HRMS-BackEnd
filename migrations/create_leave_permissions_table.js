// src/migrations/create_leave_permissions_table.js

exports.up = function(knex) {
  return knex.schema.createTable('leave_permissions', function(table) {
    table.increments('id').primary();
    table.string('permission_id').unique().notable(); // LP001, LP002, etc.
    
    // Company reference
    table.integer('company_id').unsigned().notNullable();
    table.foreign('company_id').references('id').inTable('companies').onDelete('CASCADE');
    
    // Employee reference
    table.integer('employee_id').unsigned().notNullable();
    table.foreign('employee_id').references('id').inTable('employees').onDelete('CASCADE');
    
    table.string('employee_name').notNullable();
    
    // Permission details
    table.date('permission_date').notNullable();
    table.time('permission_time_from').notNullable();
    table.time('permission_time_to').notNullable();
    table.text('reason').notNullable();
    
    // Optional attachment
    table.string('attachment_path').nullable();
    
    // Status tracking
    table.enum('status', ['pending', 'approved', 'rejected']).defaultTo('pending');
    table.integer('approved_by').unsigned().nullable();
    table.foreign('approved_by').references('id').inTable('employees').onDelete('SET NULL');
    table.datetime('approved_at').nullable();
    table.text('remarks').nullable();
    
    // Timestamps
    table.timestamps(true, true);
    
    // Indexes for better performance
    table.index(['company_id', 'status']);
    table.index(['employee_id', 'status']);
    table.index(['permission_date', 'status']);
  });
};

exports.down = function(knex) {
  return knex.schema.dropTableIfExists('leave_permissions');
};
