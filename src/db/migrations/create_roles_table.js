// db/migrations/xxxx_create_roles_table.js
exports.up = function(knex) {
  return knex.schema.createTable('roles', table => {
    table.increments('id').primary();
    table.string('role_id').unique().notNullable(); // ROLE001
    table.string('name').notNullable().unique();    // e.g., HR Manager
    table.string('approval_authority').notNullable(); // e.g., "Leave,Expense"
    table.string('data_visibility').notNullable();   // e.g., "Department"
    table.json('modules').notNullable(); // JSON object with permissions
    table.text('description').nullable();
    table.timestamps(true, true);
  });
};

exports.down = function(knex) {
  return knex.schema.dropTable('roles');
};