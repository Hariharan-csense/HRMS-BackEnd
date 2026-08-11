// db/migrations/xxxx_add_geo_fence_to_clients.js
exports.up = async function(knex) {
  const columns = await knex('clients').columnInfo();
  return knex.schema.alterTable('clients', function(table) {
    if (!columns.geo_latitude) table.decimal('geo_latitude', 10, 8).nullable();
    if (!columns.geo_longitude) table.decimal('geo_longitude', 11, 8).nullable();
    if (!columns.geo_radius) table.integer('geo_radius').defaultTo(50).nullable();
  });
};

exports.down = async function(knex) {
  const columns = await knex('clients').columnInfo();
  return knex.schema.alterTable('clients', function(table) {
    if (columns.geo_latitude) table.dropColumn('geo_latitude');
    if (columns.geo_longitude) table.dropColumn('geo_longitude');
    if (columns.geo_radius) table.dropColumn('geo_radius');
  });
};
