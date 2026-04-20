import { Client } from 'pg';
import dotenv from 'dotenv';
dotenv.config({ path: './.env' });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const client = new Client({ connectionString: process.env.PAYROLL_DATABASE_URL, ssl: { rejectUnauthorized: false } });
async function main() {
  await client.connect();
  console.log('Adding advance and sunday columns...');
  try {
    await client.query('ALTER TABLE payroll_items ADD COLUMN IF NOT EXISTS advance_deduction numeric DEFAULT 0');
    await client.query('ALTER TABLE payroll_items ADD COLUMN IF NOT EXISTS sunday_work_days numeric DEFAULT 0');
    console.log('Successfully added columns');
  } catch (err) {
    console.error('Error adding columns:', err);
  }
  await client.end();
}
main().catch(console.error);
