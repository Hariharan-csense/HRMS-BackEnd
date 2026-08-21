// Migration to add OTP fields to employees table for forgot password functionality
exports.up = async function(knex) {
  const hasResetOtp = await knex.schema.hasColumn('employees', 'reset_otp');
  const hasOtpExpiry = await knex.schema.hasColumn('employees', 'otp_expiry');
  const hasOtpVerified = await knex.schema.hasColumn('employees', 'otp_verified');

  if (hasResetOtp && hasOtpExpiry && hasOtpVerified) return;

  await knex.schema.table('employees', table => {
    if (!hasResetOtp) table.string('reset_otp').nullable(); // 6-digit OTP for password reset
    if (!hasOtpExpiry) table.dateTime('otp_expiry').nullable(); // OTP expiration timestamp
    if (!hasOtpVerified) table.boolean('otp_verified').defaultTo(false); // Flag to track if OTP is verified
  });
};

exports.down = async function(knex) {
  const hasResetOtp = await knex.schema.hasColumn('employees', 'reset_otp');
  const hasOtpExpiry = await knex.schema.hasColumn('employees', 'otp_expiry');
  const hasOtpVerified = await knex.schema.hasColumn('employees', 'otp_verified');

  await knex.schema.table('employees', table => {
    if (hasResetOtp) table.dropColumn('reset_otp');
    if (hasOtpExpiry) table.dropColumn('otp_expiry');
    if (hasOtpVerified) table.dropColumn('otp_verified');
  });
};
