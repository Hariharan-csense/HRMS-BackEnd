exports.up = async function(knex) {
  const hasShiftId = await knex.schema.hasColumn('attendance', 'shift_id');
  const hasShiftType = await knex.schema.hasColumn('attendance', 'shift_type');

  if (hasShiftId && hasShiftType) return;

  await knex.schema.table('attendance', table => {
    if (!hasShiftId) {
      table.integer('shift_id').unsigned().nullable();
    }
    if (!hasShiftType) {
      table.string('shift_type').nullable();
    }
  });
};

exports.down = async function(knex) {
  const hasShiftId = await knex.schema.hasColumn('attendance', 'shift_id');
  const hasShiftType = await knex.schema.hasColumn('attendance', 'shift_type');

  await knex.schema.table('attendance', function(table) {
    if (hasShiftId) table.dropColumn('shift_id');
    if (hasShiftType) table.dropColumn('shift_type');
  });
};
