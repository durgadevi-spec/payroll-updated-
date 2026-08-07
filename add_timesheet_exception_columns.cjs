require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.PAYROLL_DATABASE_URL });

// Adds the columns needed to support the "Timesheet Exception" feature:
// admins can waive (fully or partially) the salary deduction that would
// otherwise apply for an employee's missing timesheet days.
async function run() {
  try {
    console.log('Adding timesheet_exception_type column...');
    await pool.query("ALTER TABLE payroll_items ADD COLUMN IF NOT EXISTS timesheet_exception_type TEXT DEFAULT 'none'");

    console.log('Adding timesheet_exception_days column...');
    await pool.query('ALTER TABLE payroll_items ADD COLUMN IF NOT EXISTS timesheet_exception_days NUMERIC DEFAULT 0');

    console.log('Adding timesheet_exception_note column...');
    await pool.query('ALTER TABLE payroll_items ADD COLUMN IF NOT EXISTS timesheet_exception_note TEXT');

    console.log('Adding timesheet_exception_granted_at column...');
    await pool.query('ALTER TABLE payroll_items ADD COLUMN IF NOT EXISTS timesheet_exception_granted_at TIMESTAMPTZ');

    console.log('Success!');
  } catch (err) {
    console.error('Error modifying table:', err);
  } finally {
    process.exit(0);
  }
}
run();
