exports.up = async function (knex) {
  const hasTable = await knex.schema.hasTable("kpi_parameter_reviews");
  if (!hasTable) return;

  const hasWhatWentWrong = await knex.schema.hasColumn(
    "kpi_parameter_reviews",
    "what_went_wrong",
  );
  const hasLessonLearned = await knex.schema.hasColumn(
    "kpi_parameter_reviews",
    "lesson_learned",
  );
  const hasCorrectiveActions = await knex.schema.hasColumn(
    "kpi_parameter_reviews",
    "corrective_actions",
  );

  await knex.schema.table("kpi_parameter_reviews", function (table) {
    if (!hasWhatWentWrong) table.text("what_went_wrong").nullable();
    if (!hasLessonLearned) table.text("lesson_learned").nullable();
    if (!hasCorrectiveActions) table.text("corrective_actions").nullable();
  });

  if (!hasCorrectiveActions) {
    await knex("kpi_parameter_reviews")
      .whereNull("corrective_actions")
      .whereNotNull("feedback")
      .update({ corrective_actions: knex.ref("feedback") });
  }
};

exports.down = async function (knex) {
  const hasTable = await knex.schema.hasTable("kpi_parameter_reviews");
  if (!hasTable) return;

  const columns = [
    "what_went_wrong",
    "lesson_learned",
    "corrective_actions",
  ];
  const existing = [];

  for (const column of columns) {
    if (await knex.schema.hasColumn("kpi_parameter_reviews", column)) {
      existing.push(column);
    }
  }

  if (!existing.length) return;

  await knex.schema.table("kpi_parameter_reviews", function (table) {
    existing.forEach((column) => table.dropColumn(column));
  });
};
