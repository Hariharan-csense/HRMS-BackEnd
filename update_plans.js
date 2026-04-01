const db = require('./db/db');

(async () => {
  try {
    const plans = await db('subscription_plans').select('id', 'name', 'price', 'yearly_price');
    console.log('Current plans:');
    plans.forEach(plan => {
      console.log(`ID: ${plan.id}, Name: ${plan.name}, Monthly Price: ${plan.price}, Yearly Price: ${plan.yearly_price}`);
    });
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
})();
