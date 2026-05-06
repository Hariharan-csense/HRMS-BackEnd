exports.up = async function (knex) {
  const hasRequestedCheckIn = await knex.schema.hasColumn(
    "attendance_overrides",
    "requested_check_in"
  );
  const hasRequestedCheckOut = await knex.schema.hasColumn(
    "attendance_overrides",
    "requested_check_out"
  );

  return knex.schema.alterTable("attendance_overrides", (table) => {
    if (!hasRequestedCheckIn) {
      table.time("requested_check_in").nullable();
    }

    if (!hasRequestedCheckOut) {
      table.time("requested_check_out").nullable();
    }
  });
};

exports.down = async function (knex) {
  const hasRequestedCheckIn = await knex.schema.hasColumn(
    "attendance_overrides",
    "requested_check_in"
  );
  const hasRequestedCheckOut = await knex.schema.hasColumn(
    "attendance_overrides",
    "requested_check_out"
  );

  return knex.schema.alterTable("attendance_overrides", (table) => {
    if (hasRequestedCheckIn) {
      table.dropColumn("requested_check_in");
    }

    if (hasRequestedCheckOut) {
      table.dropColumn("requested_check_out");
    }
  });
};
