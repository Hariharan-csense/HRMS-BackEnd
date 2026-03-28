exports.up = function(knex) {
  return knex.schema.createTable('employees', table => {
    table.increments('id').primary(); // Auto unsigned int PK - Perfect for foreign keys
    table.string('employee_id').unique().notNullable(); // EMP001 format
    table.string('first_name').notNullable();
    table.string('last_name').notNullable();
    table.string('gender');
    table.date('dob');
    table.string('blood_group');
    table.string('marital_status');
    table.string('email').unique().notNullable();
    table.string('mobile');
    table.string('emergency_contact_name');
    table.string('emergency_contact_phone');
    table.date('doj');
    table.string('employment_type');
    
    // Foreign keys with unsigned - Correct
    table.integer('department_id').unsigned().nullable();
    table.integer('designation_id').unsigned().nullable();
    
    table.string('manager_name');
    table.string('location_office');
    table.enum('status', ['Active', 'Inactive']).defaultTo('Active');
    table.decimal('salary', 12, 2).defaultTo(0);
    table.string('aadhaar');
    table.string('pan');
    table.string('uan');
    table.string('esic');
    table.text('description').nullable();

    // PASSWORD - Excellent!
    table.string('password').notNullable(); // Stores bcrypt hash

    table.timestamps(true, true);

    // Foreign keys - Syntax perfect
    table.foreign('department_id').references('id').inTable('departments');
    table.foreign('designation_id').references('id').inTable('designations');
  });
};

exports.down = function(knex) {
  return knex.schema.dropTable('employees');
};