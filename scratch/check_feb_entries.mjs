import { Client } from 'pg';
import dotenv from 'dotenv';
dotenv.config({ path: './.env' });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const timesheetUrl = process.env.TIMESTRAP_DATABASE_URL || process.env.TIMESHEET_DATABASE_URL || process.env.DATABASE_URL;

async function main() {
  const client = new Client({ connectionString: timesheetUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  
  const month = 2; // February
  const year = 2026;

  console.log(`Checking time entries for Feb 2026...`);
  const res = await client.query(`
    SELECT employee_code, employee_name, count(DISTINCT date) as days_worked
    FROM time_entries
    WHERE EXTRACT(MONTH FROM CAST(date as date)) = $1 
      AND EXTRACT(YEAR FROM CAST(date as date)) = $2
    GROUP BY employee_code, employee_name
  `, [month, year]);
  
  console.log('Results:', res.rows);

  await client.end();
}
main().catch(console.error);
