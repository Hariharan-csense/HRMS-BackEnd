const ensureOtpColumns = async (knex, tableName) => {
  const hasResetOtp = await knex.schema.hasColumn(tableName, "reset_otp");
  const hasOtpExpiry = await knex.schema.hasColumn(tableName, "otp_expiry");
  const hasOtpVerified = await knex.schema.hasColumn(tableName, "otp_verified");

  if (hasResetOtp && hasOtpExpiry && hasOtpVerified) return;

  await knex.schema.alterTable(tableName, (table) => {
    if (!hasResetOtp) table.string("reset_otp", 6).nullable();
    if (!hasOtpExpiry) table.dateTime("otp_expiry").nullable();
    if (!hasOtpVerified) table.boolean("otp_verified").notNullable().defaultTo(false);
  });
};

exports.up = async function (knex) {
  await ensureOtpColumns(knex, "users");
  await ensureOtpColumns(knex, "employees");
};

exports.down = async function () {
  // Intentionally no-op: these columns may have been created by older migrations.
};
