require('dotenv').config();
const { Pool } = require('pg');
const lmsPool = new Pool({ connectionString: process.env.LMS_DATABASE_URL });
const payrollPool = new Pool({ connectionString: process.env.PAYROLL_DATABASE_URL });

async function run() {
  // Check LMS tables
  const lmsTables = await lmsPool.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name"
  );
  console.log('LMS tables:', lmsTables.rows.map(r => r.table_name).join(', '));

  // Check if permission table exists
  const permCols = await lmsPool.query(
    "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'permissions' ORDER BY ordinal_position"
  ).catch(() => ({ rows: [] }));
  if (permCols.rows.length > 0) {
    console.log('\nPermissions table columns:', permCols.rows.map(r => `${r.column_name}(${r.data_type})`).join(', '));
    const sample = await lmsPool.query('SELECT * FROM permissions LIMIT 3');
    console.log('Sample permissions:', sample.rows);
  } else {
    console.log('\nNo "permissions" table found. Checking other tables...');
    // Check leaves table for permission type
    const permLeaves = await lmsPool.query(
      "SELECT DISTINCT leave_type FROM leaves WHERE leave_type ILIKE '%perm%' OR leave_type ILIKE '%permission%' LIMIT 10"
    );
    console.log('Leave types with "perm":', permLeaves.rows);
  }

  // Check payroll_items columns
  const piCols = await payrollPool.query(
    "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'payroll_items' ORDER BY ordinal_position"
  );
  console.log('\npayroll_items columns:', piCols.rows.map(r => `${r.column_name}(${r.data_type})`).join(', '));

  process.exit(0);
}
run().catch(e => { console.error(e.message); process.exit(1); });
