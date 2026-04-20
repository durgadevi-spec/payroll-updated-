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

  const testCases = [
    { id: '69360141-a6ca-43c7-9cc2-ad9365d75ac6', name: 'REBECASUJI A', month: 3, year: 2026 },
    { id: 'd83e616b-23d6-4051-accc-cfebcad7c164', name: 'Pushpa P', month: 2, year: 2026 },
    { id: '4f8121e7-0df7-4d66-9d59-d13a5d172818', name: 'Durga', month: 4, year: 2026 }, // Testing with Durga too
  ];

  for (const tc of testCases) {
    console.log(`\nTesting: ${tc.name} (Month: ${tc.month}, Year: ${tc.year})`);
    const query = `
      SELECT 
        e.id as lms_id,
        e.name as lms_name,
        SUM(CASE WHEN l.leave_duration_type = 'Half Day' THEN 0.5 ELSE 1.0 END) as unpaid_leaves
      FROM employees e
      JOIN leaves l ON e.employee_code = l.user_id
      WHERE l.status = 'Approved'
        AND EXTRACT(MONTH FROM l.start_date) = $2
        AND EXTRACT(YEAR FROM l.start_date) = $3
        AND (e.id = $1 OR LOWER(e.name) = LOWER($4) OR e.name ILIKE $4 || '%')
      GROUP BY e.id, e.name
    `;
    const res = await client.query(query, [tc.id, tc.month, tc.year, tc.name]);
    console.log('Result:', res.rows);
  }

  await client.end();
}

main().catch(console.error);
