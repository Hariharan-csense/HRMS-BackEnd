exports.up = function(knex) {
  return knex.schema
    // Offer letters table
    .createTable('offer_letters', function(table) {
      table.increments('id').primary();
      table.integer('company_id').unsigned().notNullable();
      table.integer('candidate_id').unsigned().nullable(); // Link to recruitment_candidates
      table.string('candidate_name').notNullable();
      table.string('candidate_email').notNullable();
      table.string('position').notNullable();
      table.string('department').notNullable();
      table.string('salary').notNullable();
      table.date('start_date').notNullable();
      table.string('location').notNullable();
      table.enum('employment_type', ['full-time', 'part-time', 'contract', 'internship']).defaultTo('full-time');
      table.enum('status', ['draft', 'sent', 'accepted', 'rejected', 'expired']).defaultTo('draft');
      table.string('template').notNullable();
      table.text('custom_terms').nullable();
      table.date('sent_date').nullable();
      table.date('response_date').nullable();
      table.text('offer_content').nullable(); // Generated offer letter content
      table.string('created_by').notNullable(); // User who created
      table.string('updated_by').nullable();
      table.timestamps(true, true);

      // Foreign key constraints
      table.foreign('company_id').references('id').inTable('companies').onDelete('CASCADE');
      table.foreign('candidate_id').references('id').inTable('recruitment_candidates').onDelete('SET NULL');
      
      // Indexes
      table.index(['company_id', 'status']);
      table.index(['candidate_email']);
      table.index(['status']);
    })
    
    // Offer templates table
    .createTable('offer_templates', function(table) {
      table.increments('id').primary();
      table.integer('company_id').unsigned().notNullable();
      table.string('name').notNullable();
      table.text('content').notNullable();
      table.json('variables').nullable(); // Array of template variables
      table.boolean('is_default').defaultTo(false);
      table.boolean('is_active').defaultTo(true);
      table.string('created_by').notNullable();
      table.timestamps(true, true);

      // Foreign key constraints
      table.foreign('company_id').references('id').inTable('companies').onDelete('CASCADE');
      
      // Indexes
      table.index(['company_id', 'is_active']);
    });
};

exports.down = function(knex) {
  return knex.schema
    .dropTableIfExists('offer_templates')
    .dropTableIfExists('offer_letters');
};
