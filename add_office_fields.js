const knex = require('./db/db');

async function addOfficeFields() {
  try {
    console.log('Adding office_phone and office_email fields to employees table...');
    
    // Check if columns already exist
    const tableInfo = await knex('employees').columnInfo();
    const hasOfficePhone = 'office_phone' in tableInfo;
    const hasOfficeEmail = 'office_email' in tableInfo;
    
    if (!hasOfficePhone) {
      await knex.schema.alterTable('employees', function(table) {
        table.string('office_phone', 20).nullable();
      });
      console.log('✅ Added office_phone field');
    } else {
      console.log('ℹ️ office_phone field already exists');
    }
    
    if (!hasOfficeEmail) {
      await knex.schema.alterTable('employees', function(table) {
        table.string('office_email', 255).nullable();
      });
      console.log('✅ Added office_email field');
    } else {
      console.log('ℹ️ office_email field already exists');
    }
    
    console.log('✅ Migration completed successfully!');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
  } finally {
    await knex.destroy();
    process.exit(0);
  }
}

addOfficeFields();
