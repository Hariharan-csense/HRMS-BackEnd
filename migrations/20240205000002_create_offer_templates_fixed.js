/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.dropTableIfExists('offer_templates').then(() => {
    return knex.schema.createTable('offer_templates', function(table) {
      table.increments('id').primary();
      table.string('company_id').notNullable();
      table.string('name').notNullable();
      table.text('content').notNullable();
      table.text('variables'); // JSON string of variables array
      table.boolean('is_default').defaultTo(false);
      table.boolean('is_active').defaultTo(true);
      table.integer('created_by').unsigned();
      table.integer('updated_by').unsigned();
      table.timestamps(true, true);

      // Foreign keys
      table.foreign('company_id').references('company_id').inTable('companies').onDelete('CASCADE');
      table.foreign('created_by').references('id').inTable('users').onDelete('SET NULL');
      table.foreign('updated_by').references('id').inTable('users').onDelete('SET NULL');

      // Indexes
      table.index(['company_id', 'is_active']);
      table.index(['company_id', 'is_default']);
      table.unique(['company_id', 'name']); // Unique template name per company
    });
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.dropTableIfExists('offer_templates');
};
