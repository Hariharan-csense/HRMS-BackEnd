exports.up = function(knex) {
  return knex.schema
    // Job requirements table
    .createTable('job_requirements', function(table) {
      table.increments('id').primary();
      table.integer('company_id').unsigned().notNullable();
      table.string('title').notNullable();
      table.string('department').notNullable();
      table.string('location').notNullable();
      table.string('experience').notNullable();
      table.string('salary').notNullable();
      table.text('description').notNullable();
      table.enum('status', ['active', 'closed', 'on-hold']).defaultTo('active');
      table.integer('positions').notNullable().defaultTo(1);
      table.integer('filled_positions').defaultTo(0);
      table.enum('urgency', ['low', 'medium', 'high']).defaultTo('medium');
      table.date('closing_date').nullable();
      table.json('required_skills').nullable(); // Array of required skills
      table.json('preferred_skills').nullable(); // Array of preferred skills
      table.text('qualifications').nullable();
      table.text('responsibilities').nullable();
      table.text('benefits').nullable();
      table.string('created_by').notNullable();
      table.string('updated_by').nullable();
      table.timestamps(true, true);

      // Foreign key constraints
      table.foreign('company_id').references('id').inTable('companies').onDelete('CASCADE');
      
      // Indexes
      table.index(['company_id', 'status']);
      table.index(['department']);
      table.index(['location']);
      table.index(['urgency']);
    });
};

exports.down = function(knex) {
  return knex.schema
    .dropTableIfExists('job_requirements');
};
