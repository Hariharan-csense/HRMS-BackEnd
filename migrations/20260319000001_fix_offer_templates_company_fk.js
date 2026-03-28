exports.up = async function(knex) {
  const hasTable = await knex.schema.hasTable('offer_templates');
  if (!hasTable) {
    return;
  }

  const hasCompanyIdColumn = await knex.schema.hasColumn('offer_templates', 'company_id');
  if (!hasCompanyIdColumn) {
    return;
  }

  await knex.raw(`
    UPDATE offer_templates ot
    LEFT JOIN companies c ON c.company_id = ot.company_id
    SET ot.company_id = CAST(c.id AS CHAR)
    WHERE c.id IS NOT NULL
  `);

  const existingCompanyFk = await knex('information_schema.KEY_COLUMN_USAGE')
    .where({
      TABLE_SCHEMA: knex.client.database(),
      TABLE_NAME: 'offer_templates',
      COLUMN_NAME: 'company_id',
      REFERENCED_TABLE_NAME: 'companies'
    })
    .first();

  if (existingCompanyFk?.CONSTRAINT_NAME) {
    await knex.raw(
      `ALTER TABLE offer_templates DROP FOREIGN KEY \`${existingCompanyFk.CONSTRAINT_NAME}\``
    );
  }

  await knex.schema.alterTable('offer_templates', function(table) {
    table.integer('company_id').unsigned().notNullable().alter();
  });

  await knex.schema.alterTable('offer_templates', function(table) {
    table.foreign('company_id').references('id').inTable('companies').onDelete('CASCADE');
  });
};

exports.down = async function(knex) {
  const hasTable = await knex.schema.hasTable('offer_templates');
  if (!hasTable) {
    return;
  }

  await knex.raw(`
    UPDATE offer_templates ot
    LEFT JOIN companies c ON c.id = ot.company_id
    SET ot.company_id = c.company_id
    WHERE c.company_id IS NOT NULL
  `);

  const existingCompanyFk = await knex('information_schema.KEY_COLUMN_USAGE')
    .where({
      TABLE_SCHEMA: knex.client.database(),
      TABLE_NAME: 'offer_templates',
      COLUMN_NAME: 'company_id',
      REFERENCED_TABLE_NAME: 'companies'
    })
    .first();

  if (existingCompanyFk?.CONSTRAINT_NAME) {
    await knex.raw(
      `ALTER TABLE offer_templates DROP FOREIGN KEY \`${existingCompanyFk.CONSTRAINT_NAME}\``
    );
  }

  await knex.schema.alterTable('offer_templates', function(table) {
    table.string('company_id').notNullable().alter();
  });

  await knex.schema.alterTable('offer_templates', function(table) {
    table.foreign('company_id').references('company_id').inTable('companies').onDelete('CASCADE');
  });
};
