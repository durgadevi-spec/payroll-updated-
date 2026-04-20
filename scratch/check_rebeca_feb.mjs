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

  const name = 'samyutha';
  const month = 2; // February
  const year = 2026;

  console.log(`Checking leaves for ${name} in Feb 2026`);
  const query = `
    SELECT 
      e.name,
      l.start_date,
      l.end_date,
      l.leave_duration_type,
      l.status
    FROM employees e
    JOIN leaves l ON e.employee_code = l.user_id
    WHERE l.status = 'Approved'
      AND (
        (EXTRACT(MONTH FROM l.start_date) = $2 AND EXTRACT(YEAR FROM l.start_date) = $3)
        OR (EXTRACT(MONTH FROM l.end_date) = $2 AND EXTRACT(YEAR FROM l.end_date) = $3)
      )
      AND (e.name ILIKE $1 || '%')
  `;
  const res = await client.query(query, [name, month, year]);
  console.log('Results:', res.rows);

  await client.end();
}

main().catch(console.error);
