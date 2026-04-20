import { Client } from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: './.env' });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const client = new Client({ connectionString: process.env.PAYROLL_DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  await client.connect();
  const res = await client.query('SELECT name, email, salary FROM employees');
  console.log('Employees:', res.rows);
  console.log('Count:', res.rows.length);
  await client.end();
}

main().catch(console.error);
