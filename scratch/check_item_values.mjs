import { Client } from 'pg';
import dotenv from 'dotenv';
dotenv.config({ path: './.env' });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const client = new Client({ connectionString: process.env.PAYROLL_DATABASE_URL, ssl: { rejectUnauthorized: false } });
async function main() {
  await client.connect();
  const res = await client.query(`
    SELECT e.name, pi.unpaid_leaves, pi.missing_timesheets, pi.leave_deduction, pi.timesheet_deduction, pi.net_salary, pi.basic_salary
    FROM payroll_items pi
    JOIN employees e ON e.id = pi.employee_id
    ORDER BY pi.created_at DESC
    LIMIT 10
  `);
  console.log(res.rows);
  await client.end();
}
main().catch(console.error);
