import { Client } from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: './.env' });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const client = new Client({ 
  connectionString: process.env.LMS_DATABASE_URL, 
  ssl: { rejectUnauthorized: false } 
});

async function main() {
  await client.connect();
  console.log('Connected to LMS database');

  const employees = await client.query('SELECT id, name, employee_code FROM employees');
  console.log('Employees in LMS:', employees.rows);
  console.log('Count:', employees.rows.length);

  const users = await client.query('SELECT id, name FROM users');
  console.log('\nUsers in LMS:', users.rows);
  console.log('Count:', users.rows.length);

  await client.end();
}

main().catch(console.error);
