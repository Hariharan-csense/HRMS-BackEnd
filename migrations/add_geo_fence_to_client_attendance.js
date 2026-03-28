// db/migrations/xxxx_add_geo_fence_to_client_attendance.js
exports.up = function(knex) {
  return knex.schema.alterTable('client_attendance', function(table) {
    // Geo-fence verification flags
    table.boolean('geo_fence_verified').defaultTo(false).nullable();
    table.boolean('geo_fence_verified_checkout').defaultTo(false).nullable();
    
    // Distance from client location
    table.decimal('distance_from_client', 8, 2).nullable(); // in meters
    table.decimal('distance_from_client_checkout', 8, 2).nullable(); // in meters
  });
};

exports.down = function(knex) {
  return knex.schema.alterTable('client_attendance', function(table) {
    table.dropColumn('geo_fence_verified');
    table.dropColumn('geo_fence_verified_checkout');
    table.dropColumn('distance_from_client');
    table.dropColumn('distance_from_client_checkout');
  });
};
