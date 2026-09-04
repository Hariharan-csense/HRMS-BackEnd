exports.up = async function (knex) {
  const columns = await knex.raw('SHOW COLUMNS FROM offboarding_checklists LIKE "id"');
  const idColumn = columns?.[0]?.[0];

  if (!idColumn) return;

  const isAutoIncrement = String(idColumn.Extra || '').toLowerCase().includes('auto_increment');
  if (isAutoIncrement) return;

  const indexes = await knex.raw('SHOW INDEX FROM offboarding_checklists WHERE Key_name = "PRIMARY"');
  const primaryIndexes = indexes?.[0] || [];

  if (primaryIndexes.length === 0) {
    await knex.schema.alterTable('offboarding_checklists', (table) => {
      table.primary(['id']);
    });
  }

  await knex.raw('ALTER TABLE offboarding_checklists MODIFY id INT UNSIGNED NOT NULL AUTO_INCREMENT');
};

exports.down = async function (knex) {
  await knex.raw('ALTER TABLE offboarding_checklists MODIFY id INT UNSIGNED NOT NULL');
};
