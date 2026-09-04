exports.up = function(knex) {
  return knex.schema.alterTable('recruitment_candidates', function(table) {
    table.string('client_name').nullable().after('name');
    table.string('job_location').nullable().after('position');
    table.integer('age').nullable().after('job_location');
    table.string('gender').nullable().after('age');
    table.string('native_place').nullable().after('gender');
    table.string('highest_qualification').nullable().after('native_place');
    table.string('relevant_experience').nullable().after('experience');
    table.string('current_designation').nullable().after('current_company');
    table.string('current_location').nullable().after('current_designation');
    table.string('ctc').nullable().after('current_location');
    table.string('ectc').nullable().after('ctc');
  });
};

exports.down = function(knex) {
  return knex.schema.alterTable('recruitment_candidates', function(table) {
    table.dropColumn('ectc');
    table.dropColumn('ctc');
    table.dropColumn('current_location');
    table.dropColumn('current_designation');
    table.dropColumn('relevant_experience');
    table.dropColumn('highest_qualification');
    table.dropColumn('native_place');
    table.dropColumn('gender');
    table.dropColumn('age');
    table.dropColumn('job_location');
    table.dropColumn('client_name');
  });
};
