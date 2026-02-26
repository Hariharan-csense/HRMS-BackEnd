const db = require('./db/db');

(async () => {
  try {
    console.log('Updating billing cycles to yearly...');
    
    // Update all plans to have yearly billing cycle
    const updated = await db('subscription_plans')
      .update({ billing_cycle: 'yearly' })
      .where('billing_cycle', 'monthly');
    
    console.log(`Updated ${updated} plans to yearly billing cycle`);
    
    // Verify the update
    const plans = await db('subscription_plans').select('*');
    console.log('\nCurrent plans after update:');
    plans.forEach(plan => {
      console.log(`ID: ${plan.id}, Name: ${plan.name}, Price: ${plan.price}, Billing Cycle: ${plan.billing_cycle}`);
    });
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
})();
