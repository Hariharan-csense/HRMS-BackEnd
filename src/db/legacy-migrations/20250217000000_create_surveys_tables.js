exports.up = function(knex) {
  return knex.schema
    .createTable('surveys', function(table) {
      table.increments('id').primary();
      table.string('title').notNullable();
      table.text('description');
      table.json('questions').notNullable(); // Store questions as JSON
      table.integer('created_by').unsigned().notNullable();
      table.integer('company_id').unsigned().notNullable();
      table.enum('status', ['draft', 'active', 'closed']).defaultTo('draft');
      table.timestamps(true, true);
      
      table.foreign('created_by').references('id').inTable('users').onDelete('CASCADE');
      table.foreign('company_id').references('id').inTable('companies').onDelete('CASCADE');
    })
    .createTable('survey_responses', function(table) {
      table.increments('id').primary();
      table.integer('survey_id').unsigned().notNullable();
      table.integer('employee_id').unsigned().notNullable();
      table.json('responses').notNullable(); // Store responses as JSON
      table.timestamp('submitted_at').defaultTo(knex.fn.now());
      
      table.foreign('survey_id').references('id').inTable('surveys').onDelete('CASCADE');
      table.foreign('employee_id').references('id').inTable('users').onDelete('CASCADE');
      
      // Ensure each employee can only respond once per survey
      table.unique(['survey_id', 'employee_id']);
    });
};

exports.down = function(knex) {
  return knex.schema
    .dropTableIfExists('survey_responses')
    .dropTableIfExists('surveys');
};
