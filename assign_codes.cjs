require('dotenv').config();
const { Pool } = require('pg');
const payrollPool = new Pool({ connectionString: process.env.PAYROLL_DATABASE_URL });

async function run() {
  const fixes = [
    { name: 'leo',          code: 'E0002' },
    { name: 'Sivakumar',    code: 'E0057' },
    { name: 'UMAR FAROOQUE',code: 'E0040' },
    { name: 'SAM PRAKASH',  code: 'E0001' },
    { name: 'RANJITH',      code: 'E0009' },
  ];

  console.log('--- Assigning employee codes ---');
  for (const fix of fixes) {
    const r = await payrollPool.query(
      'UPDATE employees SET employee_code = $1 WHERE name = $2',
      [fix.code, fix.name]
    );
    console.log(`${fix.name} -> ${fix.code}: ${r.rowCount} row(s) updated`);
  }

  // Verify
  console.log('\n--- Verification ---');
  const verify = await payrollPool.query(
    "SELECT name, employee_code FROM employees WHERE name = ANY($1) ORDER BY name",
    [fixes.map(f => f.name)]
  );
  verify.rows.forEach(r => console.log(` ${r.name} -> ${r.employee_code}`));

  process.exit(0);
}
run().catch(e => { console.error(e.message); process.exit(1); });
