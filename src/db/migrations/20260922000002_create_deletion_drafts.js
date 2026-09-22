exports.up = async (knex) => {
  await knex.schema.createTable("deletion_drafts", (t) => {
    t.increments("id").primary();
    // Deliberately no foreign keys: the archive must outlive the deleted record/company.
    t.integer("company_id").unsigned().nullable().index();
    t.string("entity", 80).notNullable();
    t.string("record_id", 160).notNullable();
    t.string("record_label", 255).notNullable();
    t.string("status", 24).notNullable().defaultTo("pending").index();
    t.string("pending_key", 64).nullable().unique();
    t.text("archive", "longtext").notNullable();
    t.json("summary").notNullable();
    t.string("requested_by", 100).notNullable();
    t.string("requested_by_name", 255).notNullable();
    t.text("reason").nullable();
    t.string("reviewed_by", 100).nullable();
    t.string("reviewed_by_name", 255).nullable();
    t.timestamp("reviewed_at").nullable();
    t.text("review_note").nullable();
    t.string("restored_by", 100).nullable();
    t.string("restored_by_name", 255).nullable();
    t.timestamp("restored_at").nullable();
    t.timestamps(true, true);
  });
};
exports.down = (knex) => knex.schema.dropTable("deletion_drafts");
