require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.PAYROLL_DATABASE_URL });

async function run() {
  const v1 = 'f7bcf2de-022f-434d-91f4-7f91127f16c8';
  const v2 = '44be1e42-b3aa-4870-ae18-af7519273fa6';

  console.log('=== VERSION 1 ITEMS ===');
  const res1 = await pool.query(
    `SELECT e.name, pi.monthly_salary, pi.calculation_days, pi.net_salary, pi.timesheet_deduction
     FROM payroll_items pi
     JOIN employees e ON e.id = pi.employee_id
     WHERE pi.payroll_id = $1
     ORDER BY e.name`,
    [v1]
  );
  console.table(res1.rows);

  console.log('\n=== VERSION 2 ITEMS ===');
  const res2 = await pool.query(
    `SELECT e.name, pi.monthly_salary, pi.calculation_days, pi.net_salary, pi.timesheet_deduction
     FROM payroll_items pi
     JOIN employees e ON e.id = pi.employee_id
     WHERE pi.payroll_id = $1
     ORDER BY e.name`,
    [v2]
  );
  console.table(res2.rows);

  process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });
