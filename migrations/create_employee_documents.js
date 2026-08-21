exports.up = async function(knex) {
  const exists = await knex.schema.hasTable('employee_documents');
  if (exists) return;

  await knex.schema.createTable('employee_documents', table => {
    table.increments('id').primary();
    table.integer('employee_id').unsigned().notNullable();
    table.string('type').notNullable(); // photo, id_proof, address_proof, offer_letter, etc.
    table.string('file_path').notNullable();
    table.string('original_name');
    table.timestamps(true, true);

    table.foreign('employee_id').references('id').inTable('employees').onDelete('CASCADE');
  });
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('employee_documents');
};
