const db = require('./db/db');

(async () => {
  try {
    await db('subscription_plans').update({ billing_cycle: 'yearly' });
    console.log('Updated all plans to yearly billing cycle');
    
    const plans = await db('subscription_plans').select('*');
    console.log('Updated plans:');
    plans.forEach(plan => {
      console.log(`ID: ${plan.id}, Name: ${plan.name}, Price: ${plan.price}, Billing Cycle: ${plan.billing_cycle}`);
    });
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
})();
