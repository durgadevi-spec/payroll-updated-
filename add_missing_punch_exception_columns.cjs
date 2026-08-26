require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.PAYROLL_DATABASE_URL });

// Adds the columns needed to support the "Missing Punch Exception" feature:
// admins can waive the salary deduction for individual missing-punch days
// (selected via checkboxes, one per date), rather than only all-or-nothing.
async function run() {
  try {
    console.log('Adding missing_punch_exception_dates column...');
    await pool.query("ALTER TABLE payroll_items ADD COLUMN IF NOT EXISTS missing_punch_exception_dates JSONB DEFAULT '[]'");

    console.log('Adding missing_punch_exception_note column...');
    await pool.query('ALTER TABLE payroll_items ADD COLUMN IF NOT EXISTS missing_punch_exception_note TEXT');

    console.log('Adding missing_punch_exception_granted_at column...');
    await pool.query('ALTER TABLE payroll_items ADD COLUMN IF NOT EXISTS missing_punch_exception_granted_at TIMESTAMPTZ');

    console.log('Success!');
  } catch (err) {
    console.error('Error modifying table:', err);
  } finally {
    process.exit(0);
  }
}
run();
