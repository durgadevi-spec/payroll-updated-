require('dotenv').config();
const { Pool } = require('pg');
const payrollPool = new Pool({ connectionString: process.env.PAYROLL_DATABASE_URL });

async function run() {
  console.log('--- Before ---');
  const before = await payrollPool.query(
    "SELECT name, employee_code FROM employees WHERE name IN ('test empolyee', 'MOHAN RAJ C')"
  );
  before.rows.forEach(r => console.log(' ', r.name, '->', r.employee_code));

  // Remove E0041 from test empolyee (it was wrongly assigned)
  const r1 = await payrollPool.query(
    "UPDATE employees SET employee_code = NULL WHERE name = 'test empolyee' AND employee_code = 'E0041'"
  );
  console.log('\nRemoved E0041 from test empolyee:', r1.rowCount, 'row(s) updated');

  // Assign E0041 to MOHAN RAJ C (correct assignment)
  const r2 = await payrollPool.query(
    "UPDATE employees SET employee_code = 'E0041' WHERE name = 'MOHAN RAJ C'"
  );
  console.log('Assigned E0041 to MOHAN RAJ C:', r2.rowCount, 'row(s) updated');

  console.log('\n--- After ---');
  const after = await payrollPool.query(
    "SELECT name, employee_code FROM employees WHERE name IN ('test empolyee', 'MOHAN RAJ C')"
  );
  after.rows.forEach(r => console.log(' ', r.name, '->', r.employee_code));

  process.exit(0);
}
run().catch(e => { console.error(e.message); process.exit(1); });
