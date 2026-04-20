import { Client } from 'pg';
import dotenv from 'dotenv';
dotenv.config({ path: './.env' });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const client = new Client({ connectionString: process.env.PAYROLL_DATABASE_URL, ssl: { rejectUnauthorized: false } });
async function main() {
  await client.connect();
  console.log('Dropping unique constraint from payrolls...');
  try {
    await client.query('ALTER TABLE payrolls DROP CONSTRAINT IF EXISTS payrolls_month_year_key');
    await client.query('DROP INDEX IF EXISTS payrolls_month_year_key');
    console.log('Successfully dropped unique constraint/index');
  } catch (err) {
    console.error('Error dropping constraint:', err);
  }
  await client.end();
}
main().catch(console.error);
