// db/migrations/xxxx_create_assets_table.js
exports.up = function(knex) {
  return knex.schema.createTable('assets', table => {
    table.increments('id').primary();
    table.string('asset_id').unique().notNullable(); // AST001
    table.string('name').notNullable();             // e.g., Dell XPS 13
    table.string('type').notNullable();             // Laptop, Monitor, etc.
    table.string('serial_number').unique().notNullable();
    table.integer('assigned_employee_id').unsigned().nullable(); // foreign key to employees.id
    table.string('assigned_employee_name').nullable(); // for quick display
    table.date('issue_date').nullable();
    table.enum('status', ['Active', 'Inactive', 'Returned', 'Lost']).defaultTo('Active');
    table.string('location').nullable();            // e.g., Office - Desk 1
    table.decimal('value', 12, 2).defaultTo(0);     // in ₹
    table.text('description').nullable();
    table.timestamps(true, true);

    // Foreign key to employees (optional - add later if employees table ready)
    // table.foreign('assigned_employee_id').references('id').inTable('employees').onDelete('SET NULL');
  });
};

exports.down = function(knex) {
  return knex.schema.dropTable('assets');
};