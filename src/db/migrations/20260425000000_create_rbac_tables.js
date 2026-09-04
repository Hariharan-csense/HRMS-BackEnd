/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // 1. Modules Table - Store all available modules in the system
  const hasModules = await knex.schema.hasTable('modules');
  if (!hasModules) {
    await knex.schema.createTable('modules', (table) => {
      table.increments('id').primary();
      table.string('module_key').unique().notNullable();
      table.string('label').notNullable();
      table.string('parent_key').nullable(); // For submodules
      table.integer('sort_order').defaultTo(0);
      table.boolean('is_active').defaultTo(true);
      table.timestamps(true, true);
    });
  }

  // 2. Permissions Table - Store available actions/permissions
  const hasPermissions = await knex.schema.hasTable('permissions');
  if (!hasPermissions) {
    await knex.schema.createTable('permissions', (table) => {
      table.increments('id').primary();
      table.string('name').unique().notNullable(); // view, create, update, delete
      table.string('label').notNullable();
      table.string('description').nullable();
      table.integer('sort_order').defaultTo(0);
      table.boolean('is_active').defaultTo(true);
      table.timestamps(true, true);
    });
  }

  // 3. Role Modules Table - Store which modules are accessible by which roles
  const hasRoleModules = await knex.schema.hasTable('role_modules');
  if (!hasRoleModules) {
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
  }

  // 4. Role Permissions Table - Store which permissions each role has on each module
  const hasRolePermissions = await knex.schema.hasTable('role_permissions');
  if (!hasRolePermissions) {
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
  }

  // 5. Add new columns to existing roles table for migration tracking
  const hasUseNewRbac = await knex.schema.hasColumn('roles', 'use_new_rbac');
  if (!hasUseNewRbac) {
    await knex.schema.table('roles', (table) => {
      // Avoid using DB-specific modifiers like `.after()` so this works across engines
      table.boolean('use_new_rbac').defaultTo(false);
    });
  }

  // 6. Add module_id to role_assignments for granular module-based assignments
  const hasRoleAssignments = await knex.schema.hasTable('role_assignments');
  if (hasRoleAssignments) {
    const hasModuleId = await knex.schema.hasColumn('role_assignments', 'module_id');
    const hasCustomPermissions = await knex.schema.hasColumn('role_assignments', 'custom_permissions');
    if (!hasModuleId || !hasCustomPermissions) {
      await knex.schema.table('role_assignments', (table) => {
        if (!hasModuleId) {
          table.integer('module_id').unsigned().nullable()
            .references('id').inTable('modules').onDelete('SET NULL');
        }
        if (!hasCustomPermissions) {
          table.string('custom_permissions').nullable(); // JSON string for custom permissions
        }
      });
    }
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // Drop added columns/tables only if they exist to avoid errors on rollback
  const hasRoleAssignments = await knex.schema.hasTable('role_assignments');
  if (hasRoleAssignments) {
    const hasModuleId = await knex.schema.hasColumn('role_assignments', 'module_id');
    const hasCustomPermissions = await knex.schema.hasColumn('role_assignments', 'custom_permissions');
    if (hasModuleId || hasCustomPermissions) {
      await knex.schema.table('role_assignments', (table) => {
        if (hasModuleId) table.dropColumn('module_id');
        if (hasCustomPermissions) table.dropColumn('custom_permissions');
      });
    }
  }

  const hasRolesTable = await knex.schema.hasTable('roles');
  if (hasRolesTable) {
    const hasUseNew = await knex.schema.hasColumn('roles', 'use_new_rbac');
    if (hasUseNew) {
      await knex.schema.table('roles', (table) => {
        table.dropColumn('use_new_rbac');
      });
    }
  }

  await knex.schema.dropTableIfExists('role_permissions');
  await knex.schema.dropTableIfExists('role_modules');
  await knex.schema.dropTableIfExists('permissions');
  await knex.schema.dropTableIfExists('modules');
};