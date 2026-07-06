const { Pool } = require('pg');
require('dotenv').config();

async function applyMigration() {
  const connectionString = process.env.PAYROLL_DATABASE_URL;
  
  if (!connectionString) {
    console.error('PAYROLL_DATABASE_URL not found in .env');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: connectionString,
    ssl: { rejectUnauthorized: false },
  });

  try {
    console.log('Connecting to database...');
    const client = await pool.connect();

    console.log('Applying migration: Add reporting_manager column...');
    await client.query(`
      ALTER TABLE employees 
      ADD COLUMN IF NOT EXISTS reporting_manager text DEFAULT '';
    `);
    console.log('✓ reporting_manager column added');

    console.log('Applying migration: Rename salary to ctc...');
    try {
      await client.query(`
        ALTER TABLE employees 
        RENAME COLUMN salary TO ctc;
      `);
      console.log('✓ salary column renamed to ctc');
    } catch (err) {
      if (err.message.includes('does not exist')) {
        console.log('⚠ Column salary does not exist (already renamed?)');
      } else {
        throw err;
      }
    }

    console.log('✓ Migration applied successfully!');
    
    // Verify the changes
    const result = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'employees' 
      AND column_name IN ('ctc', 'reporting_manager', 'salary')
      ORDER BY column_name;
    `);
    
    console.log('\nVerification - Columns in employees table:');
    result.rows.forEach(row => {
      console.log(`  - ${row.column_name} (${row.data_type})`);
    });

    client.release();
    await pool.end();
    
    console.log('\n✓ All done! You can now save employees.');
    process.exit(0);
  } catch (error) {
    console.error('Error applying migration:', error.message);
    process.exit(1);
  }
}

applyMigration();
