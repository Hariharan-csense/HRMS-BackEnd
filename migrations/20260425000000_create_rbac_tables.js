/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // 1. Modules Table - Store all available modules in the system
  await knex.schema.createTable('modules', (table) => {
    table.increments('id').primary();
    table.string('module_key').unique().notNullable();
    table.string('label').notNullable();
    table.string('parent_key').nullable(); // For submodules
    table.integer('sort_order').defaultTo(0);
    table.boolean('is_active').defaultTo(true);
    table.timestamps(true, true);
  });

  // 2. Permissions Table - Store available actions/permissions
  await knex.schema.createTable('permissions', (table) => {
    table.increments('id').primary();
    table.string('name').unique().notNullable(); // view, create, update, delete
    table.string('label').notNullable();
    table.string('description').nullable();
    table.integer('sort_order').defaultTo(0);
    table.boolean('is_active').defaultTo(true);
    table.timestamps(true, true);
  });

  // 3. Role Modules Table - Store which modules are accessible by which roles
  await knex.schema.createTable('role_modules', (table) => {
    table.increments('id').primary();
    table.integer('role_id').unsigned().notNullable()
      .references('id').inTable('roles').onDelete('CASCADE');
    table.integer('module_id').unsigned().notNullable()
      .references('id').inTable('modules').onDelete('CASCADE');
    table.boolean('is_enabled').defaultTo(true);
    table.timestamps(true, true);
    
    // Unique constraint - one entry per role-module combination
    table.unique(['role_id', 'module_id']);
  });

  // 4. Role Permissions Table - Store which permissions each role has on each module
  await knex.schema.createTable('role_permissions', (table) => {
    table.increments('id').primary();
    table.integer('role_id').unsigned().notNullable()
      .references('id').inTable('roles').onDelete('CASCADE');
    table.integer('module_id').unsigned().notNullable()
      .references('id').inTable('modules').onDelete('CASCADE');
    table.integer('permission_id').unsigned().notNullable()
      .references('id').inTable('permissions').onDelete('CASCADE');
    table.boolean('is_allowed').defaultTo(true);
    table.timestamps(true, true);
    
    // Unique constraint - one entry per role-module-permission combination
    table.unique(['role_id', 'module_id', 'permission_id']);
  });

  // 5. Add new columns to existing roles table for migration tracking
  await knex.schema.table('roles', (table) => {
    table.boolean('use_new_rbac').defaultTo(false).after('modules');
  });

  // 6. Add module_id to role_assignments for granular module-based assignments
  await knex.schema.table('role_assignments', (table) => {
    table.integer('module_id').unsigned().nullable()
      .references('id').inTable('modules').onDelete('SET NULL');
    table.string('custom_permissions').nullable(); // JSON string for custom permissions
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // Drop foreign keys first
  await knex.schema.table('role_assignments', (table) => {
    table.dropColumn('module_id');
    table.dropColumn('custom_permissions');
  });

  await knex.schema.table('roles', (table) => {
    table.dropColumn('use_new_rbac');
  });

  await knex.schema.dropTableIfExists('role_permissions');
  await knex.schema.dropTableIfExists('role_modules');
  await knex.schema.dropTableIfExists('permissions');
  await knex.schema.dropTableIfExists('modules');
};