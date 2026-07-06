import { Client } from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: './.env' });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const payrollUrl = process.env.PAYROLL_DATABASE_URL;

async function updateSalaries() {
  const client = new Client({ connectionString: payrollUrl, ssl: { rejectUnauthorized: false } });

  try {
    await client.connect();
    console.log('Updating all salaries to 12,000...');
    const res = await client.query('UPDATE employees SET salary = 12000');
    console.log(`Successfully updated ${res.rowCount} employees.`);
  } catch (err) {
    console.error('Update failed:', err);
  } finally {
    await client.end();
  }
}

updateSalaries();
