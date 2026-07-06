require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.PAYROLL_DATABASE_URL });

async function run() {
  try {
    console.log('Adding permission_hours column...');
    await pool.query('ALTER TABLE payroll_items ADD COLUMN IF NOT EXISTS permission_hours NUMERIC DEFAULT 0');
    console.log('Adding permission_deduction column...');
    await pool.query('ALTER TABLE payroll_items ADD COLUMN IF NOT EXISTS permission_deduction NUMERIC DEFAULT 0');
    console.log('Success!');
  } catch (err) {
    console.error('Error modifying table:', err);
  } finally {
    process.exit(0);
  }
}
run();
