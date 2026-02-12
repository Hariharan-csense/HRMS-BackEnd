// db/migrations/xxxx_add_geo_fence_to_clients.js
exports.up = function(knex) {
  return knex.schema.alterTable('clients', function(table) {
    // Geo-fence coordinates
    table.decimal('geo_latitude', 10, 8).nullable();
    table.decimal('geo_longitude', 11, 8).nullable();
    table.integer('geo_radius').defaultTo(50).nullable(); // Default 50 meters
    
    // Index for faster geo queries
    table.index(['geo_latitude', 'geo_longitude']);
  });
};

exports.down = function(knex) {
  return knex.schema.alterTable('clients', function(table) {
    table.dropColumn('geo_latitude');
    table.dropColumn('geo_longitude');
    table.dropColumn('geo_radius');
  });
};
