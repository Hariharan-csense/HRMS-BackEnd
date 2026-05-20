exports.seed = async function (knex) {
  const hasAddonsTable = await knex.schema.hasTable("subscription_addons");
  if (hasAddonsTable) {
    const addonColumns = await knex("subscription_addons").columnInfo();
    const withModuleKey = (data, moduleKey) =>
      addonColumns.module_key ? { ...data, module_key: moduleKey } : data;

    await knex("subscription_addons").del();
    await knex("subscription_addons").insert([
      withModuleKey(
        {
          id: 1,
          name: "Client Attendance + Live Tracking",
          description: "Client attendance and live tracking module",
          price_upto25: 100.0,
          price_upto50: 100.0,
          price_above50: 100.0,
          is_active: true,
          created_at: new Date(),
          updated_at: new Date(),
        },
        "live_tracking",
      ),
      withModuleKey(
        {
          id: 2,
          name: "Expenses",
          description: "Expense claims and approvals",
          price_upto25: 100.0,
          price_upto50: 100.0,
          price_above50: 100.0,
          is_active: true,
          created_at: new Date(),
          updated_at: new Date(),
        },
        "expenses",
      ),
      withModuleKey(
        {
          id: 3,
          name: "RMS",
          description: "Recruitment management system",
          price_upto25: 100.0,
          price_upto50: 100.0,
          price_above50: 100.0,
          is_active: true,
          created_at: new Date(),
          updated_at: new Date(),
        },
        "hr_management",
      ),
      withModuleKey(
        {
          id: 4,
          name: "Ticket",
          description: "Ticket management",
          price_upto25: 100.0,
          price_upto50: 100.0,
          price_above50: 100.0,
          is_active: true,
          created_at: new Date(),
          updated_at: new Date(),
        },
        "tickets",
      ),
      withModuleKey(
        {
          id: 5,
          name: "Exit Offboarding",
          description: "Exit and offboarding management",
          price_upto25: 100.0,
          price_upto50: 100.0,
          price_above50: 100.0,
          is_active: true,
          created_at: new Date(),
          updated_at: new Date(),
        },
        "exit",
      ),
    ]);
  }
};
