exports.up = async function(knex) {
  const hasTdsPercentage = await knex.schema.hasColumn('payroll_structures', 'tds_percentage');
  if (!hasTdsPercentage) {
    await knex.schema.alterTable('payroll_structures', table => {
      table.decimal('tds_percentage', 5, 2).defaultTo(0).after('tds');
    });
  }

  const hasTdsAmount = await knex.schema.hasColumn('payroll_processing', 'tds_amount');
  if (!hasTdsAmount) {
    await knex.schema.alterTable('payroll_processing', table => {
      table.decimal('tds_amount', 12, 2).defaultTo(0).after('gross');
    });
  }
};

exports.down = async function(knex) {
  const hasTdsAmount = await knex.schema.hasColumn('payroll_processing', 'tds_amount');
  if (hasTdsAmount) {
    await knex.schema.alterTable('payroll_processing', table => {
      table.dropColumn('tds_amount');
    });
  }

  const hasTdsPercentage = await knex.schema.hasColumn('payroll_structures', 'tds_percentage');
  if (hasTdsPercentage) {
    await knex.schema.alterTable('payroll_structures', table => {
      table.dropColumn('tds_percentage');
    });
  }
};
