import { Client } from 'pg';
import dotenv from 'dotenv';
dotenv.config({ path: './.env' });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const client = new Client({ connectionString: process.env.PAYROLL_DATABASE_URL, ssl: { rejectUnauthorized: false } });
async function main() {
  await client.connect();
  console.log('Altering table payroll_items...');
  await client.query('ALTER TABLE payroll_items ALTER COLUMN unpaid_leaves TYPE numeric');
  await client.query('ALTER TABLE payroll_items ALTER COLUMN missing_timesheets TYPE numeric');
  console.log('Successfully updated column types');
  await client.end();
}
main().catch(console.error);
