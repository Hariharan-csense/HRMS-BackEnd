exports.up = async (knex) => {
  await knex.schema.alterTable("deletion_drafts", (t) => {
    t.string("record_code", 160).nullable().after("record_id");
  });
};

exports.down = async (knex) => {
  await knex.schema.alterTable("deletion_drafts", (t) => {
    t.dropColumn("record_code");
  });
};
