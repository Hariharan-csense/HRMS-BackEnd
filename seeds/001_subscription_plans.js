exports.seed = async function(knex) {
  // Deletes ALL existing entries
  await knex('subscription_plans').del();
  
  // Insert default subscription plans
  await knex('subscription_plans').insert([
    {
      id: 1,
      name: 'Basic',
      description: 'Perfect for small teams getting started with HR management\n\nIncludes:\n- Organization Setup\n- Employee Management\n- Attendance Management\n- Leave Management\n- Reports',
      price: 1499.00,
      max_users: 10,
      storage_gb: 2,
      trial_days: 7,
      billing_cycle: 'yearly',
      is_active: true,
      created_at: new Date(),
      updated_at: new Date()
    },
    {
      id: 2,
      name: 'Professional',
      description: 'Ideal for growing businesses with advanced HR needs\n\nIncludes:\n- Organization Setup\n- Employee Management\n- Attendance Management\n- Leave Management\n- Reports\n- Payroll\n- Expenses\n- Assets\n- Live Tracking\n- Role & Module Access',
      price: 2999.00,
      max_users: 25,
      storage_gb: 5,
      trial_days: 7,
      billing_cycle: 'yearly',
      is_active: true,
      created_at: new Date(),
      updated_at: new Date()
    },
    {
      id: 3,
      name: 'Enterprise',
      description: 'Complete HR solution for large organizations\n\nIncludes:\n- Organization Setup\n- Employee Management\n- Attendance Management\n- Leave Management\n- Reports\n- Payroll\n- Expenses\n- Assets\n- Live Tracking\n- Role & Module Access\n- RMS (Recruitment & Onboarding)\n- Exit & Offboarding\n- Pulse (Employee Happiness Survey)\n- KPI Reports\n- Client Attendance\n- Client Attendance Admin\n- Ticket Management',
      price: 5999.00,
      max_users: 100,
      storage_gb: 10,
      trial_days: 14,
      billing_cycle: 'yearly',
      is_active: true,
      created_at: new Date(),
      updated_at: new Date()
    }
  ]);
};
