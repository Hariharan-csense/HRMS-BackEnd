exports.up = async function (knex) {
  const exists = await knex.schema.hasTable('client_assignments');
  if (!exists) {
    await knex.schema.createTable('client_assignments', (table) => {
      table.increments('id').primary();
      table.integer('client_id').unsigned().notNullable()
        .references('id')
        .inTable('clients')
        .onDelete('CASCADE');
      table.integer('employee_id').unsigned().notNullable()
        .references('id')
        .inTable('employees')
        .onDelete('CASCADE');
      table.timestamps(true, true);

      table.unique(['client_id', 'employee_id']);
      table.index(['employee_id', 'client_id']);
    });
  }

  const legacyAssignments = await knex('clients')
    .select('id as client_id', 'assigned_to as employee_id')
    .whereNotNull('assigned_to');

  if (legacyAssignments.length) {
    await knex('client_assignments')
      .insert(legacyAssignments)
      .onConflict(['client_id', 'employee_id'])
      .ignore();
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('client_assignments');
};
