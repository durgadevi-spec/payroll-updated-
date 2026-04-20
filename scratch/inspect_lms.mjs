import { Client } from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: './.env' });

const client = new Client({ 
  connectionString: process.env.LMS_DATABASE_URL, 
  ssl: { rejectUnauthorized: false } 
});

async function main() {
  await client.connect();
  console.log('Connected to LMS database');

  // List all tables
  const tablesRes = await client.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name`);
  console.log('Tables:', tablesRes.rows.map(r => r.table_name).join(', '));

  // Inspect lms_leaves
  if (tablesRes.rows.some(r => r.table_name === 'lms_leaves')) {
    console.log('\n--- lms_leaves ---');
    const cols = await client.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name='lms_leaves'`);
    console.log('Columns:', cols.rows.map(r => `${r.column_name} (${r.data_type})`).join(', '));
    
    const sample = await client.query(`SELECT * FROM lms_leaves LIMIT 5`);
    console.log('Sample rows:', sample.rows);

    const monthCounts = await client.query(`SELECT month, year, count(*) FROM lms_leaves GROUP BY month, year ORDER BY year DESC, month DESC`);
    console.log('Month counts:', monthCounts.rows);
  } else {
    console.log('\nTable lms_leaves NOT FOUND!');
  }

  // Inspect leaves
  if (tablesRes.rows.some(r => r.table_name === 'leaves')) {
    console.log('\n--- leaves ---');
    const cols = await client.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name='leaves'`);
    console.log('Columns:', cols.rows.map(r => `${r.column_name} (${r.data_type})`).join(', '));
    
    const sample = await client.query(`SELECT * FROM leaves LIMIT 5`);
    console.log('Sample rows:', sample.rows);

    const monthCounts = await client.query(`SELECT count(*) FROM leaves`);
    console.log('Total leaves count:', monthCounts.rows[0].count);
  }

  // Test aggregate query
  console.log('\n--- Test Aggregate Query ---');
  const query = `
    SELECT 
      e.id as lms_employee_id,
      e.name,
      e.employee_code,
      COUNT(*) as leave_count,
      SUM(CASE WHEN l.leave_duration_type = 'Half Day' THEN 0.5 ELSE 1.0 END) as total_days
    FROM employees e
    JOIN leaves l ON e.employee_code = l.user_id
    WHERE l.status = 'Approved'
      AND EXTRACT(MONTH FROM l.start_date) = 1  -- Testing January since sample was Jan
      AND EXTRACT(YEAR FROM l.start_date) = 2026
    GROUP BY e.id, e.name, e.employee_code
  `;
  try {
    const aggRes = await client.query(query);
    console.log('Results (Jan 2026):', aggRes.rows);
  } catch (err) {
    console.error('Aggregate query failed:', err.message);
  }

  // Check Feb/March specifically
  const febMarQuery = `
    SELECT 
      EXTRACT(MONTH FROM start_date) as month,
      COUNT(*) 
    FROM leaves 
    WHERE status = 'Approved' AND EXTRACT(YEAR FROM start_date) = 2026
    GROUP BY month
  `;
  const febMarRes = await client.query(febMarQuery);
  console.log('Month distribution for 2026:', febMarRes.rows);

  // Check Durga's leaves
  console.log('\n--- DurgaDevi Leaves ---');
  const durgaLeaves = await client.query(`
    SELECT l.* FROM leaves l
    JOIN employees e ON e.employee_code = l.user_id
    WHERE e.name ILIKE '%Durga%'
  `);
  console.log('Durga leaves:', durgaLeaves.rows);

  await client.end();
}

main().catch(console.error);
