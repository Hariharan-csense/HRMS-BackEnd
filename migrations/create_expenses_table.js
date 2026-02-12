// db/migrations/xxxx_create_expenses_table.js
exports.up = function(knex) {
  return knex.schema.createTable('expenses', table => {
    table.increments('id').primary();
    table.string('expense_id').unique().notNullable(); // EXP001
    table.integer('employee_id').unsigned().notNullable(); // link to employees.id
    table.string('employee_name').notNullable();
    table.string('category').notNullable(); // Travel, Meals, etc.
    table.decimal('amount', 12, 2).notNullable(); // in ₹
    table.date('expense_date').notNullable();
    table.text('description').nullable();
    table.string('receipt_path').nullable(); // /uploads/expenses/receipt-12345.pdf
    table.enum('status', ['Pending', 'Approved', 'Rejected']).defaultTo('Pending');
    table.integer('approved_by').unsigned().nullable(); // admin who approved/rejected
    table.timestamp('approved_at').nullable();
    table.timestamps(true, true);

    // Foreign keys
    // table.foreign('employee_id').references('id').inTable('employees');
    // table.foreign('approved_by').references('id').inTable('employees');
  });
};

exports.down = function(knex) {
  return knex.schema.dropTable('expenses');
};