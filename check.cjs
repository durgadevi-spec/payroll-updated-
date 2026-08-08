require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.PAYROLL_DATABASE_URL });
async function check() {
  const res = await pool.query(`
    SELECT p.month, p.year, p.version, pi.leave_deduction, pi.unpaid_leaves, pi.missing_punches, pi.hourly_deduction 
    FROM payrolls p 
    JOIN payroll_items pi ON p.id = pi.payroll_id 
    JOIN employees e ON pi.employee_id = e.id
    WHERE e.name ILIKE '%Ishwarya%' 
    ORDER BY p.created_at DESC LIMIT 3
  `);
  console.log('Payroll Versions:', res.rows);
  process.exit(0);
}
check();
