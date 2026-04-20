import { Client } from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: './.env' });

const client = new Client({ 
  connectionString: process.env.PAYROLL_DATABASE_URL, 
  ssl: { rejectUnauthorized: false } 
});

async function main() {
  await client.connect();
  console.log('Connected to PAYROLL database');

  const employees = await client.query(`SELECT id, name, email FROM employees LIMIT 5`);
  console.log('Sample payroll employees:', employees.rows);

  await client.end();
}

main().catch(console.error);
