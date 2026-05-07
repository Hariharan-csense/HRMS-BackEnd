exports.up = async function(knex) {
  const hasLogo = await knex.schema.hasColumn('companies', 'logo');
  const hasSignature = await knex.schema.hasColumn('companies', 'signature');

  if (!hasLogo) {
    await knex.schema.table('companies', (table) => {
      table.string('logo').nullable().after('address');
    });
  }

  if (!hasSignature) {
    await knex.schema.table('companies', (table) => {
      table.string('signature').nullable().after('logo');
    });
  }
};

exports.down = async function(knex) {
  const hasSignature = await knex.schema.hasColumn('companies', 'signature');

  if (hasSignature) {
    await knex.schema.table('companies', (table) => {
      table.dropColumn('signature');
    });
  }
};
