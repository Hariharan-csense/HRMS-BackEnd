/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema
    // Drop foreign key constraints first
    .raw('ALTER TABLE settlement_components DROP FOREIGN KEY IF EXISTS settlement_components_settlement_id_foreign')
    .raw('ALTER TABLE settlement_documents DROP FOREIGN KEY IF EXISTS settlement_documents_settlement_id_foreign')
    .raw('ALTER TABLE settlement_approvals DROP FOREIGN KEY IF EXISTS settlement_approvals_settlement_id_foreign')
    .raw('ALTER TABLE settlement_approvals DROP FOREIGN KEY IF EXISTS settlement_approvals_approver_id_foreign')
    
    // Modify settlements table
    .alterTable('settlements', function(table) {
      table.dropPrimary();
      table.dropIndex(['employee_id']);
      table.dropIndex(['company_id']);
      table.dropIndex(['status']);
      table.dropIndex(['created_at']);
    })
    .raw('ALTER TABLE settlements MODIFY COLUMN id INT AUTO_INCREMENT PRIMARY KEY')
    .alterTable('settlements', function(table) {
      table.index(['employee_id']);
      table.index(['company_id']);
      table.index(['status']);
      table.index(['created_at']);
    })
    
    // Modify settlement_components table
    .alterTable('settlement_components', function(table) {
      table.dropPrimary();
      table.dropIndex(['settlement_id']);
      table.dropIndex(['type']);
    })
    .raw('ALTER TABLE settlement_components MODIFY COLUMN id INT AUTO_INCREMENT PRIMARY KEY')
    .alterTable('settlement_components', function(table) {
      table.index(['settlement_id']);
      table.index(['type']);
    })
    
    // Modify settlement_documents table
    .alterTable('settlement_documents', function(table) {
      table.dropPrimary();
      table.dropIndex(['settlement_id']);
      table.dropIndex(['document_type']);
    })
    .raw('ALTER TABLE settlement_documents MODIFY COLUMN id INT AUTO_INCREMENT PRIMARY KEY')
    .alterTable('settlement_documents', function(table) {
      table.index(['settlement_id']);
      table.index(['document_type']);
    })
    
    // Modify settlement_approvals table
    .alterTable('settlement_approvals', function(table) {
      table.dropPrimary();
      table.dropIndex(['settlement_id']);
      table.dropIndex(['approver_id']);
      table.dropIndex(['action_date']);
    })
    .raw('ALTER TABLE settlement_approvals MODIFY COLUMN id INT AUTO_INCREMENT PRIMARY KEY')
    .alterTable('settlement_approvals', function(table) {
      table.index(['settlement_id']);
      table.index(['approver_id']);
      table.index(['action_date']);
    })
    
    // Re-add foreign key constraints
    .raw('ALTER TABLE settlement_components ADD CONSTRAINT settlement_components_settlement_id_foreign FOREIGN KEY (settlement_id) REFERENCES settlements(id) ON DELETE CASCADE')
    .raw('ALTER TABLE settlement_documents ADD CONSTRAINT settlement_documents_settlement_id_foreign FOREIGN KEY (settlement_id) REFERENCES settlements(id) ON DELETE CASCADE')
    .raw('ALTER TABLE settlement_approvals ADD CONSTRAINT settlement_approvals_settlement_id_foreign FOREIGN KEY (settlement_id) REFERENCES settlements(id) ON DELETE CASCADE');
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema
    // Drop foreign key constraints
    .raw('ALTER TABLE settlement_components DROP FOREIGN KEY IF EXISTS settlement_components_settlement_id_foreign')
    .raw('ALTER TABLE settlement_documents DROP FOREIGN KEY IF EXISTS settlement_documents_settlement_id_foreign')
    .raw('ALTER TABLE settlement_approvals DROP FOREIGN KEY IF EXISTS settlement_approvals_settlement_id_foreign')
    
    // Revert settlements table back to UUID
    .alterTable('settlements', function(table) {
      table.dropPrimary();
      table.dropIndex(['employee_id']);
      table.dropIndex(['company_id']);
      table.dropIndex(['status']);
      table.dropIndex(['created_at']);
    })
    .raw('ALTER TABLE settlements MODIFY COLUMN id UUID DEFAULT (UUID()) PRIMARY KEY')
    .alterTable('settlements', function(table) {
      table.index(['employee_id']);
      table.index(['company_id']);
      table.index(['status']);
      table.index(['created_at']);
    })
    
    // Revert settlement_components table back to UUID
    .alterTable('settlement_components', function(table) {
      table.dropPrimary();
      table.dropIndex(['settlement_id']);
      table.dropIndex(['type']);
    })
    .raw('ALTER TABLE settlement_components MODIFY COLUMN id UUID DEFAULT (UUID()) PRIMARY KEY')
    .alterTable('settlement_components', function(table) {
      table.index(['settlement_id']);
      table.index(['type']);
    })
    
    // Revert settlement_documents table back to UUID
    .alterTable('settlement_documents', function(table) {
      table.dropPrimary();
      table.dropIndex(['settlement_id']);
      table.dropIndex(['document_type']);
    })
    .raw('ALTER TABLE settlement_documents MODIFY COLUMN id UUID DEFAULT (UUID()) PRIMARY KEY')
    .alterTable('settlement_documents', function(table) {
      table.index(['settlement_id']);
      table.index(['document_type']);
    })
    
    // Revert settlement_approvals table back to UUID
    .alterTable('settlement_approvals', function(table) {
      table.dropPrimary();
      table.dropIndex(['settlement_id']);
      table.dropIndex(['approver_id']);
      table.dropIndex(['action_date']);
    })
    .raw('ALTER TABLE settlement_approvals MODIFY COLUMN id UUID DEFAULT (UUID()) PRIMARY KEY')
    .alterTable('settlement_approvals', function(table) {
      table.index(['settlement_id']);
      table.index(['approver_id']);
      table.index(['action_date']);
    })
    
    // Re-add foreign key constraints
    .raw('ALTER TABLE settlement_components ADD CONSTRAINT settlement_components_settlement_id_foreign FOREIGN KEY (settlement_id) REFERENCES settlements(id) ON DELETE CASCADE')
    .raw('ALTER TABLE settlement_documents ADD CONSTRAINT settlement_documents_settlement_id_foreign FOREIGN KEY (settlement_id) REFERENCES settlements(id) ON DELETE CASCADE')
    .raw('ALTER TABLE settlement_approvals ADD CONSTRAINT settlement_approvals_settlement_id_foreign FOREIGN KEY (settlement_id) REFERENCES settlements(id) ON DELETE CASCADE');
};
