import { Client } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

const payrollUrl = process.env.PAYROLL_DATABASE_URL;

function normalizeConnectionString(connectionString) {
  try {
    const url = new URL(connectionString);
    url.searchParams.delete('sslmode');
    return url.toString();
  } catch {
    return connectionString.replace(/([?&])sslmode=(require|prefer|verify-ca)(&|$)/gi, (match, sep, mode, tail) => {
      if (sep === '?') {
        return tail ? '?' : '';
      }
      return tail ? sep : '';
    });
  }
}

async function run() {
  const client = new Client({
    connectionString: normalizeConnectionString(payrollUrl),
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    
    // Add columns to employees
    await client.query(`
      ALTER TABLE employees
      ADD COLUMN IF NOT EXISTS use_pa_sla BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS pa_sla_balance NUMERIC DEFAULT 0;
    `);
    console.log('Added use_pa_sla and pa_sla_balance to employees table.');

    // Add column to payroll_items
    await client.query(`
      ALTER TABLE payroll_items
      ADD COLUMN IF NOT EXISTS pa_sla_consumed NUMERIC DEFAULT 0;
    `);
    console.log('Added pa_sla_consumed to payroll_items table.');

  } catch (error) {
    console.error('Migration error:', error);
  } finally {
    await client.end();
  }
}

run();
