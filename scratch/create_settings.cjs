const { Pool } = require('pg');
require('dotenv').config({ path: './.env' });

const pool = new Pool({
  connectionString: process.env.PAYROLL_DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS system_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);
    
    // Seed with initial values
    await client.query(`
      INSERT INTO system_settings (key, value)
      VALUES ('biometric_ip', '192.168.1.201'), ('biometric_port', '4370')
      ON CONFLICT (key) DO NOTHING
    `);
    
    console.log("system_settings table created/verified.");
  } catch(e) {
    console.error(e);
  } finally {
    client.release();
    pool.end();
  }
}
run();
