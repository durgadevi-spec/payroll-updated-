require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.PAYROLL_DATABASE_URL });

async function run() {
  // First show current state
  const before = await pool.query("SELECT id, name, employee_code FROM employees WHERE name ILIKE '%test%'");
  console.log('Before:', before.rows);
  
  // Update employee_code for test empolyee
  const upd = await pool.query(
    "UPDATE employees SET employee_code = 'E0041' WHERE name = 'test empolyee'"
  );
  console.log('Updated rows:', upd.rowCount);
  
  const after = await pool.query("SELECT id, name, employee_code FROM employees WHERE name ILIKE '%test%'");
  console.log('After:', after.rows);
  
  process.exit(0);
}
run().catch(e => { console.error('Error:', e.message); process.exit(1); });
