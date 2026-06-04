const columns = ['opening_balance', 'availed', 'available', 'total'];

exports.up = async function(knex) {
  for (const column of columns) {
    const exists = await knex.schema.hasColumn('leave_balances', column);
    if (!exists) continue;

    if (column === 'total') {
      await knex('leave_balances')
        .whereNull('total')
        .update({ total: knex.ref('opening_balance') });
    }

    await knex.schema.alterTable('leave_balances', (table) => {
      if (column === 'total') {
        table.decimal(column, 6, 2).nullable().alter();
      } else {
        table.decimal(column, 6, 2).notNullable().defaultTo(0).alter();
      }
    });
  }
};

exports.down = async function(knex) {
  for (const column of columns) {
    const exists = await knex.schema.hasColumn('leave_balances', column);
    if (!exists) continue;

    await knex.schema.alterTable('leave_balances', (table) => {
      if (column === 'total') {
        table.integer(column).nullable().alter();
      } else {
        table.integer(column).notNullable().defaultTo(0).alter();
      }
    });
  }
};
