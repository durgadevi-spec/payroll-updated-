require('dotenv').config();
const { Pool } = require('pg');
const payrollPool = new Pool({ connectionString: process.env.PAYROLL_DATABASE_URL });

async function run() {
  const res = await payrollPool.query(
    `SELECT id, month, year, version, status, generated_at, total_amount
     FROM payrolls
     WHERE month = 7 AND year = 2026
     ORDER BY version DESC`
  );
  console.log('--- July 2026 payroll batches (newest version first) ---');
  console.table(res.rows);
  process.exit(0);
}
run().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
