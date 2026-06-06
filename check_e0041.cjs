require('dotenv').config();
const { Pool } = require('pg');

async function run() {
  const lmsPool = new Pool({ connectionString: process.env.LMS_DATABASE_URL });
  const payrollPool = new Pool({ connectionString: process.env.PAYROLL_DATABASE_URL });
  
  // Check payroll DB for employee named 'test empolyee' 
  const empRes = await payrollPool.query("SELECT name, employee_code, email FROM employees");
  const testEmp = empRes.rows.find(e => e.name && e.name.toLowerCase().includes('test'));
  console.log('Test employee in payroll DB:', testEmp);
  
  // Check what approved leaves exist in LMS for E0041
  const lmsRes = await lmsPool.query(
    "SELECT user_id, leave_type, status, start_date, end_date FROM leaves WHERE LOWER(status) = 'approved' AND EXTRACT(MONTH FROM start_date) = 5 AND EXTRACT(YEAR FROM start_date) = 2026"
  );
  console.log('\nAll approved May leaves in LMS:', lmsRes.rows.map(l => ({ user_id: l.user_id, type: l.leave_type, start: l.start_date })));
  
  process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });
