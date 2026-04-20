import { Client } from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: './.env' });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const client = new Client({ connectionString: process.env.PAYROLL_DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  await client.connect();
  
  // Get February 2026 payroll id
  const pRes = await client.query("SELECT id FROM payrolls WHERE month = 2 AND year = 2026");
  if (pRes.rows.length === 0) {
    console.log('February payroll not found');
    await client.end();
    return;
  }
  const payrollId = pRes.rows[0].id;
  console.log('Payroll ID:', payrollId);

  // Check orphaned items
  const orphansRes = await client.query(`
    SELECT pi.id, pi.employee_id, pi.payroll_id
    FROM payroll_items pi
    LEFT JOIN employees e ON e.id = pi.employee_id
    WHERE pi.payroll_id = $1 AND e.id IS NULL
  `, [payrollId]);
  
  console.log(`Found ${orphansRes.rows.length} orphaned payroll items for February.`);
  if (orphansRes.rows.length > 0) {
    console.log('Sample orphan employee_id:', orphansRes.rows[0].employee_id);
  }

  await client.end();
}

main().catch(console.error);
