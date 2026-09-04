exports.up = function(knex) {
  return knex.schema
    // Onboarding employees table
    .createTable('onboarding_employees', function(table) {
      table.increments('id').primary();
      table.integer('company_id').unsigned().notNullable();
      table.string('name').notNullable();
      table.string('email').notNullable();
      table.string('phone').notNullable();
      table.string('position').notNullable();
      table.string('department').notNullable();
      table.date('start_date').notNullable();
      table.string('location').notNullable();
      table.string('manager').notNullable();
      table.enum('status', ['pending', 'in-progress', 'completed', 'delayed']).defaultTo('pending');
      table.integer('progress').defaultTo(0); // Percentage progress
      table.text('notes').nullable();
      table.string('created_by').notNullable();
      table.string('updated_by').nullable();
      table.timestamps(true, true);

      // Foreign key constraints
      table.foreign('company_id').references('id').inTable('companies').onDelete('CASCADE');
      
      // Indexes
      table.index(['company_id', 'status']);
      table.index(['email']);
      table.index(['start_date']);
    })
    
    // Onboarding tasks table
    .createTable('onboarding_tasks', function(table) {
      table.increments('id').primary();
      table.integer('employee_id').unsigned().notNullable();
      table.string('title').notNullable();
      table.text('description').notNullable();
      table.enum('category', ['documentation', 'it-setup', 'hr-process', 'orientation']).notNullable();
      table.date('due_date').nullable();
      table.boolean('completed').defaultTo(false);
      table.date('completed_date').nullable();
      table.string('assigned_to').nullable(); // Who is responsible for this task
      table.enum('priority', ['low', 'medium', 'high']).defaultTo('medium');
      table.string('created_by').notNullable();
      table.timestamps(true, true);

      // Foreign key constraints
      table.foreign('employee_id').references('id').inTable('onboarding_employees').onDelete('CASCADE');
      
      // Indexes
      table.index(['employee_id', 'completed']);
      table.index(['category']);
      table.index(['priority']);
    })
    
    // Onboarding documents table
    .createTable('onboarding_documents', function(table) {
      table.increments('id').primary();
      table.integer('employee_id').unsigned().notNullable();
      table.string('name').notNullable();
      table.string('type').notNullable(); // ID Proof, Tax Document, etc.
      table.boolean('required').defaultTo(true);
      table.boolean('uploaded').defaultTo(false);
      table.date('upload_date').nullable();
      table.string('file_url').nullable();
      table.string('created_by').notNullable();
      table.timestamps(true, true);

      // Foreign key constraints
      table.foreign('employee_id').references('id').inTable('onboarding_employees').onDelete('CASCADE');
      
      // Indexes
      table.index(['employee_id', 'required']);
      table.index(['uploaded']);
    });
};

exports.down = function(knex) {
  return knex.schema
    .dropTableIfExists('onboarding_documents')
    .dropTableIfExists('onboarding_tasks')
    .dropTableIfExists('onboarding_employees');
};
