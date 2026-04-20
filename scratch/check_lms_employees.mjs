import { Client } from 'pg';
import dotenv from 'dotenv';
dotenv.config({ path: './.env' });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const client = new Client({ connectionString: process.env.LMS_DATABASE_URL, ssl: { rejectUnauthorized: false } });
async function main() {
  await client.connect();
  const res = await client.query("SELECT id, name, employee_code, email FROM employees LIMIT 10");
  console.log('LMS Employees:', res.rows);
  await client.end();
}
main().catch(console.error);
