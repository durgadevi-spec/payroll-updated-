import { Client } from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: './.env' });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const client = new Client({ 
  connectionString: process.env.TIMESTRAP_DATABASE_URL || process.env.TIMESHEET_DATABASE_URL, 
  ssl: { rejectUnauthorized: false } 
});

async function main() {
  await client.connect();
  console.log('Connected to TIMESHEET database');

  const employees = await client.query(`SELECT id, name, email FROM employees LIMIT 10`);
  console.log('Sample timesheet employees:', employees.rows);

  await client.end();
}

main().catch(console.error);
