exports.seed = async function(knex) {
  // Deletes ALL existing entries
  await knex('subscription_plans').del();
  
  // Insert default subscription plans (three packages)
  await knex('subscription_plans').insert([
    {
      id: 1,
      name: 'Package 1',
      description: 'Organization Setup\nEmployee Management\nAttendance Management (Office Based)\nLeave Management\nRole & Module Access Debug\nReports',
      price: 400.0,
      price_upto25: 400.0,
      price_upto50: 350.0,
      price_above50: 300.0,
      max_users: 0,
      storage_gb: 2,
      trial_days: 7,
      billing_cycle: 'monthly',
      is_active: true,
      created_at: new Date(),
      updated_at: new Date()
    },
    {
      id: 2,
      name: 'Package 2',
      description: 'All In Package 1\nClient Attendance + Live Tracking\nExpenses\nTicket',
      price: 600.0,
      price_upto25: 600.0,
      price_upto50: 550.0,
      price_above50: 500.0,
      max_users: 0,
      storage_gb: 5,
      trial_days: 7,
      billing_cycle: 'monthly',
      is_active: true,
      created_at: new Date(),
      updated_at: new Date()
    },
    {
      id: 3,
      name: 'Package 3',
      description: 'All in Package 1 & 2\nRMS',
      price: 700.0,
      price_upto25: 700.0,
      price_upto50: 650.0,
      price_above50: 600.0,
      max_users: 0,
      storage_gb: 10,
      trial_days: 7,
      billing_cycle: 'monthly',
      is_active: true,
      created_at: new Date(),
      updated_at: new Date()
    }
  ]);

  const hasAddonsTable = await knex.schema.hasTable('subscription_addons');
  if (hasAddonsTable) {
    await knex('subscription_addons').del();
    await knex('subscription_addons').insert([
      {
        id: 1,
        name: 'Client Attendance + Live Tracking',
        description: 'Client attendance and live tracking module',
        price_upto25: 100.0,
        price_upto50: 100.0,
        price_above50: 100.0,
        is_active: true,
        created_at: new Date(),
        updated_at: new Date()
      },
      {
        id: 2,
        name: 'Expenses',
        description: 'Expense claims and approvals',
        price_upto25: 100.0,
        price_upto50: 100.0,
        price_above50: 100.0,
        is_active: true,
        created_at: new Date(),
        updated_at: new Date()
      },
      {
        id: 3,
        name: 'RMS',
        description: 'Recruitment management system',
        price_upto25: 100.0,
        price_upto50: 100.0,
        price_above50: 100.0,
        is_active: true,
        created_at: new Date(),
        updated_at: new Date()
      },
      {
        id: 4,
        name: 'Ticket',
        description: 'Ticket management',
        price_upto25: 100.0,
        price_upto50: 100.0,
        price_above50: 100.0,
        is_active: true,
        created_at: new Date(),
        updated_at: new Date()
      },
      {
        id: 5,
        name: 'Exit Offboarding',
        description: 'Exit and offboarding management',
        price_upto25: 100.0,
        price_upto50: 100.0,
        price_above50: 100.0,
        is_active: true,
        created_at: new Date(),
        updated_at: new Date()
      }
    ]);
  }
};
