exports.up = function(knex) {
  return knex.schema
    // Recruitment candidates table
    .createTable('recruitment_candidates', function(table) {
      table.increments('id').primary();
      table.integer('company_id').unsigned().notNullable();
      table.string('name').notNullable();
      table.string('email').notNullable();
      table.string('phone').notNullable();
      table.string('position').notNullable();
      table.string('department').notNullable();
      table.string('experience').notNullable();
      table.string('current_company').nullable();
      table.string('expected_salary').nullable();
      table.string('notice_period').nullable();
      table.json('skills').nullable(); // Array of skills
      table.string('resume_url').nullable();
      table.enum('status', ['applied', 'screening', 'interview', 'technical', 'hr-round', 'offered', 'rejected', 'hired']).defaultTo('applied');
      table.date('applied_date').notNullable();
      table.text('notes').nullable();
      table.string('source').nullable(); // LinkedIn, referral, etc.
      table.string('created_by').notNullable();
      table.string('updated_by').nullable();
      table.timestamps(true, true);

      // Foreign key constraints
      table.foreign('company_id').references('id').inTable('companies').onDelete('CASCADE');
      
      // Indexes
      table.index(['company_id', 'status']);
      table.index(['email']);
      table.index(['position']);
      table.index(['department']);
    })
    
    // Candidate interviews table
    .createTable('candidate_interviews', function(table) {
      table.increments('id').primary();
      table.integer('candidate_id').unsigned().notNullable();
      table.enum('type', ['screening', 'technical', 'hr-round']).notNullable();
      table.date('interview_date').notNullable();
      table.time('interview_time').notNullable();
      table.string('interviewer').notNullable();
      table.enum('status', ['scheduled', 'completed', 'cancelled']).defaultTo('scheduled');
      table.text('feedback').nullable();
      table.integer('rating').nullable(); // 1-5 rating
      table.string('created_by').notNullable();
      table.timestamps(true, true);

      // Foreign key constraints
      table.foreign('candidate_id').references('id').inTable('recruitment_candidates').onDelete('CASCADE');
      
      // Indexes
      table.index(['candidate_id', 'status']);
      table.index(['interview_date']);
    });
};

exports.down = function(knex) {
  return knex.schema
    .dropTableIfExists('candidate_interviews')
    .dropTableIfExists('recruitment_candidates');
};
