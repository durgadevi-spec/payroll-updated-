const { Pool } = require('pg');
require('dotenv').config({ path: './.env' });

const pool = new Pool({
  connectionString: process.env.TIMESTRAP_DATABASE_URL || process.env.TIMESHEET_DATABASE_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  const client = await pool.connect();
  try {
    const res = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);
    console.log("Tables in TIMESTRAP DB:", res.rows.map(r => r.table_name));
    
    // Check if there's an attendance table
    if (res.rows.find(r => r.table_name === 'attendance' || r.table_name === 'attendance_logs' || r.table_name === 'time_entries')) {
        const entries = await client.query('SELECT * FROM time_entries LIMIT 1');
        console.log("time_entries sample:", entries.rows);
    }
  } catch(e) {
    console.error(e);
  } finally {
    client.release();
    pool.end();
  }
}
run();
