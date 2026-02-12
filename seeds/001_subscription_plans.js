exports.seed = async function(knex) {
  // Deletes ALL existing entries
  await knex('subscription_plans').del();
  
  // Insert default subscription plans
  await knex('subscription_plans').insert([
    {
      id: 1,
      name: 'Basic',
      description: 'Perfect for small teams getting started with HR management',
      price: 1499.00,
      max_users: 10,
      storage_gb: 2,
      trial_days: 7,
      billing_cycle: 'monthly',
      is_active: true,
      created_at: new Date(),
      updated_at: new Date()
    },
    {
      id: 2,
      name: 'Professional',
      description: 'Ideal for growing businesses with advanced HR needs',
      price: 2999.00,
      max_users: 25,
      storage_gb: 5,
      trial_days: 7,
      billing_cycle: 'monthly',
      is_active: true,
      created_at: new Date(),
      updated_at: new Date()
    },
    {
      id: 3,
      name: 'Enterprise',
      description: 'Complete HR solution for large organizations',
      price: 5999.00,
      max_users: 100,
      storage_gb: 10,
      trial_days: 14,
      billing_cycle: 'monthly',
      is_active: true,
      created_at: new Date(),
      updated_at: new Date()
    }
  ]);
};
