const knex = require('./db/db');

async function testTemplatesTable() {
  try {
    console.log('Testing offer_templates table...');
    
    // Check if table exists
    const tableExists = await knex.schema.hasTable('offer_templates');
    console.log('Table exists:', tableExists);
    
    if (tableExists) {
      // Get table structure
      const columns = await knex('offer_templates').columnInfo();
      console.log('Table columns:', Object.keys(columns));
      
      // Try to get templates
      const templates = await knex('offer_templates').select('*').limit(5);
      console.log('Templates count:', templates.length);
      console.log('Sample templates:', templates);
      
      // Check companies table
      const companies = await knex('companies').select('company_id', 'company_name').limit(3);
      console.log('Available companies:', companies);
      
    } else {
      console.log('Table does not exist. Creating it...');
      
      // Create the table
      await knex.schema.createTable('offer_templates', function(table) {
        table.increments('id').primary();
        table.string('company_id').notNullable();
        table.string('name').notNullable();
        table.text('content').notNullable();
        table.text('variables');
        table.boolean('is_default').defaultTo(false);
        table.boolean('is_active').defaultTo(true);
        table.integer('created_by').unsigned();
        table.integer('updated_by').unsigned();
        table.timestamps(true, true);
      });
      
      console.log('Table created successfully');
    }
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await knex.destroy();
  }
}

testTemplatesTable();
