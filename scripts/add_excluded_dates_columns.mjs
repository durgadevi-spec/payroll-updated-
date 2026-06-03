import { Client } from 'pg';
import * as dotenv from 'dotenv';
dotenv.config();

function normalizeConnectionString(str) {
  try {
    const url = new URL(str);
    url.searchParams.delete('sslmode');
    return url.toString();
  } catch {
    return str;
  }
}

async function run() {
  const client = new Client({
    connectionString: normalizeConnectionString(process.env.PAYROLL_DATABASE_URL),
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();

    // 1. Add timesheet_excluded_dates to payroll_items
    await client.query(`
      ALTER TABLE payroll_items
      ADD COLUMN IF NOT EXISTS timesheet_excluded_dates JSONB DEFAULT '[]'::jsonb;
    `);
    console.log('✅ Added timesheet_excluded_dates to payroll_items.');

    // 2. Add holiday_dates column to payroll_items (store the holiday dates used for this employee)
    await client.query(`
      ALTER TABLE payroll_items
      ADD COLUMN IF NOT EXISTS holiday_dates JSONB DEFAULT '[]'::jsonb;
    `);
    console.log('✅ Added holiday_dates to payroll_items.');

    // 3. Add applicable_departments to holidays table (null = applies to all)
    await client.query(`
      ALTER TABLE holidays
      ADD COLUMN IF NOT EXISTS applicable_departments TEXT[] DEFAULT NULL;
    `);
    console.log('✅ Added applicable_departments to holidays table.');

  } catch (error) {
    console.error('Migration error:', error);
  } finally {
    await client.end();
  }
}

run();
