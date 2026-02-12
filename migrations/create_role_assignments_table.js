exports.up = function(knex) {
  return knex.schema.createTable('role_assignments', table => {
    table.increments('id').primary();
    table.integer('employee_id').unsigned().notNullable();
    table.integer('role_id').unsigned().notNullable();
    table.integer('company_id').unsigned().notNullable();
    table.enum('status', ['Active', 'Inactive']).defaultTo('Active');
    table.date('assigned_date').defaultTo(knex.fn.now());
    table.date('removed_date').nullable();
    table.text('remarks').nullable();
    table.timestamps(true, true);

    // Foreign keys
    table.foreign('employee_id').references('id').inTable('employees').onDelete('CASCADE');
    table.foreign('role_id').references('id').inTable('roles').onDelete('CASCADE');
    table.foreign('company_id').references('id').inTable('companies').onDelete('CASCADE');

    // Ensure an employee can only have one active role at a time
    table.unique(['employee_id', 'company_id'], {
      where: { status: 'Active' }
    });

    // Indexes for performance
    table.index(['employee_id']);
    table.index(['role_id']);
    table.index(['company_id']);
  });
};

exports.down = function(knex) {
  return knex.schema.dropTable('role_assignments');
};
