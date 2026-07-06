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
      CREATE TABLE IF NOT EXISTS advances (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
        amount NUMERIC(10, 2) NOT NULL,
        date DATE NOT NULL,
        reason TEXT,
        repayment_type VARCHAR(50) NOT NULL,
        installment_amount NUMERIC(10, 2) NOT NULL,
        balance NUMERIC(10, 2) NOT NULL,
        remarks TEXT,
        status VARCHAR(20) DEFAULT 'Active',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log("Table 'advances' created successfully.");
  } catch(e) {
    console.error(e);
  } finally {
    client.release();
    pool.end();
  }
}
run();
