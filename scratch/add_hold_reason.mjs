import pkg from 'pg';
const { Client } = pkg;
import * as dotenv from 'dotenv';
dotenv.config();
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const payrollUrl = process.env.PAYROLL_DATABASE_URL;

async function run() {
  const client = new Client({ connectionString: payrollUrl, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();

    // Add hold_reason column to payslips
    await client.query(`
      ALTER TABLE payslips 
      ADD COLUMN IF NOT EXISTS hold_reason TEXT
    `);
    
    // Update status check if necessary? 
    // Usually 'draft', 'paid', 'held'
    
    console.log('✅ Added hold_reason to payslips table.');

  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

run();
