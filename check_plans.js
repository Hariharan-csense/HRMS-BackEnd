const db = require('./db/db');

(async () => {
  try {
    const plans = await db('subscription_plans').select('*');
    console.log('Current plans in database:');
    plans.forEach(plan => {
      console.log(`ID: ${plan.id}, Name: ${plan.name}, Price: ${plan.price}, Billing Cycle: ${plan.billing_cycle}`);
    });
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
})();
