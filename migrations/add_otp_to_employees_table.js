// Migration to add OTP fields to employees table for forgot password functionality
exports.up = function(knex) {
  return knex.schema.table('employees', table => {
    table.string('reset_otp').nullable(); // 6-digit OTP for password reset
    table.dateTime('otp_expiry').nullable(); // OTP expiration timestamp
    table.boolean('otp_verified').defaultTo(false); // Flag to track if OTP is verified
  });
};

exports.down = function(knex) {
  return knex.schema.table('employees', table => {
    table.dropColumn('reset_otp');
    table.dropColumn('otp_expiry');
    table.dropColumn('otp_verified');
  });
};
