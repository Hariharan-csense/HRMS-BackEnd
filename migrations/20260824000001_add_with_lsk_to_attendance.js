exports.up = async function (knex) {
  if (!(await knex.schema.hasColumn("attendance", "with_lsk"))) {
    await knex.schema.alterTable("attendance", (table) => {
      table.boolean("with_lsk").notNullable().defaultTo(false).after("status");
    });
  }
};

exports.down = async function (knex) {
  if (await knex.schema.hasColumn("attendance", "with_lsk")) {
    await knex.schema.alterTable("attendance", (table) => {
      table.dropColumn("with_lsk");
    });
  }
};
