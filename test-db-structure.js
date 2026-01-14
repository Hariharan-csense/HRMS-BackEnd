const knex = require('./db/db');

async function checkTableStructure() {
  try {
    console.log('Checking employees table structure...');
    
    // Get table info
    const tableInfo = await knex('employees').columnInfo();
    console.log('Employees table columns:', Object.keys(tableInfo));
    
    // Try to get a sample record
    const sampleRecord = await knex('employees').first();
    console.log('Sample record:', sampleRecord);
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await knex.destroy();
  }
}

checkTableStructure();
