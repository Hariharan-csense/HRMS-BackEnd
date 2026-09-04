// Migration to add OTP fields to users table for forgot password functionality
exports.up = async function(knex) {
  const hasResetOtp = await knex.schema.hasColumn('users', 'reset_otp');
  const hasOtpExpiry = await knex.schema.hasColumn('users', 'otp_expiry');
  const hasOtpVerified = await knex.schema.hasColumn('users', 'otp_verified');

  if (hasResetOtp && hasOtpExpiry && hasOtpVerified) return;

  await knex.schema.table('users', table => {
    if (!hasResetOtp) table.string('reset_otp').nullable(); // 6-digit OTP for password reset
    if (!hasOtpExpiry) table.dateTime('otp_expiry').nullable(); // OTP expiration timestamp
    if (!hasOtpVerified) table.boolean('otp_verified').defaultTo(false); // Flag to track if OTP is verified
  });
};

exports.down = async function(knex) {
  const hasResetOtp = await knex.schema.hasColumn('users', 'reset_otp');
  const hasOtpExpiry = await knex.schema.hasColumn('users', 'otp_expiry');
  const hasOtpVerified = await knex.schema.hasColumn('users', 'otp_verified');

  await knex.schema.table('users', table => {
    if (hasResetOtp) table.dropColumn('reset_otp');
    if (hasOtpExpiry) table.dropColumn('otp_expiry');
    if (hasOtpVerified) table.dropColumn('otp_verified');
  });
};
