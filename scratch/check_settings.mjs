import { Client } from 'pg';
import dotenv from 'dotenv';
dotenv.config({ path: './.env' });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const payrollUrl = process.env.PAYROLL_DATABASE_URL;

async function main() {
  const client = new Client({ connectionString: payrollUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  
  console.log('--- Settings ---');
  const res = await client.query("SELECT * FROM settings");
  console.log(res.rows);

  await client.end();
}
main().catch(console.error);
