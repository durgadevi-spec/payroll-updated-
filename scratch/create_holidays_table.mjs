import pkg from 'pg';
const { Client } = pkg;
import * as dotenv from 'dotenv';
dotenv.config();
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const payrollUrl = process.env.PAYROLL_DATABASE_URL;

async function run() {
  const client = new Client({ connectionString: payrollUrl, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();

    await client.query(`
      CREATE TABLE IF NOT EXISTS holidays (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        date DATE NOT NULL UNIQUE,
        name VARCHAR(100) NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    console.log('✅ holidays table created.');

    // Add some common Indian holidays for 2026 as a starting point
    const holidays = [
      { date: '2026-01-01', name: 'New Year' },
      { date: '2026-01-14', name: 'Pongal' },
      { date: '2026-01-26', name: 'Republic Day' },
      { date: '2026-04-14', name: 'Tamil New Year' },
      { date: '2026-05-01', name: 'May Day' },
      { date: '2026-08-15', name: 'Independence Day' },
      { date: '2026-10-02', name: 'Gandhi Jayanti' },
      { date: '2026-12-25', name: 'Christmas' },
    ];

    for (const h of holidays) {
      await client.query(
        `INSERT INTO holidays (date, name) VALUES ($1, $2) ON CONFLICT (date) DO NOTHING`,
        [h.date, h.name]
      );
    }
    console.log('✅ Default holidays seeded.');

  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

run();
