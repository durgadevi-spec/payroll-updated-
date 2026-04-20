import { Client } from 'pg';
import dotenv from 'dotenv';
dotenv.config({ path: './.env' });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const client = new Client({ connectionString: process.env.PAYROLL_DATABASE_URL, ssl: { rejectUnauthorized: false } });
async function main() {
  await client.connect();
  const res = await client.query("SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'payrolls'");
  console.log(res.rows);
  await client.end();
}
main().catch(console.error);
