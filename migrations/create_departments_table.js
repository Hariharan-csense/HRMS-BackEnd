// db/migrations/xxxx_create_departments_table.js
exports.up = function(knex) {
  return knex.schema.createTable('departments', table => {
    table.increments('id').primary();
    table.string('dept_id').unique().notNullable();     // DEPT001
    table.string('name').notNullable().unique();
    table.string('cost_center').unique().notNullable(); // CC1001
    table.string('head_name').nullable();              // Department Head Name
    table.integer('head_id').unsigned().nullable();    // Future: link to employees.id
    table.text('description').nullable();
    table.timestamps(true, true);

    // Foreign key (optional now, add later when employees table ready)
    // table.foreign('head_id').references('id').inTable('employees');
  });
};

exports.down = function(knex) {
  return knex.schema.dropTable('departments');
};