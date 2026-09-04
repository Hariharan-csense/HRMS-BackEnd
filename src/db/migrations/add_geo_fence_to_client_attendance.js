// db/migrations/xxxx_add_geo_fence_to_client_attendance.js
exports.up = async function(knex) {
  const columns = await knex('client_attendance').columnInfo();
  return knex.schema.alterTable('client_attendance', function(table) {
    if (!columns.geo_fence_verified) table.boolean('geo_fence_verified').defaultTo(false).nullable();
    if (!columns.geo_fence_verified_checkout) table.boolean('geo_fence_verified_checkout').defaultTo(false).nullable();
    if (!columns.distance_from_client) table.decimal('distance_from_client', 8, 2).nullable();
    if (!columns.distance_from_client_checkout) table.decimal('distance_from_client_checkout', 8, 2).nullable();
  });
};

exports.down = async function(knex) {
  const columns = await knex('client_attendance').columnInfo();
  return knex.schema.alterTable('client_attendance', function(table) {
    if (columns.geo_fence_verified) table.dropColumn('geo_fence_verified');
    if (columns.geo_fence_verified_checkout) table.dropColumn('geo_fence_verified_checkout');
    if (columns.distance_from_client) table.dropColumn('distance_from_client');
    if (columns.distance_from_client_checkout) table.dropColumn('distance_from_client_checkout');
  });
};
