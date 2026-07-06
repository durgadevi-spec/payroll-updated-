import { Client } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

function normalizeConnectionString(connectionString) {
  try {
    const url = new URL(connectionString);
    url.searchParams.delete('sslmode');
    return url.toString();
  } catch {
    return connectionString.replace(/([?&])sslmode=(require|prefer|verify-ca)(&|$)/gi, (match, sep, mode, tail) => {
      if (sep === '?') {
        return tail ? '?' : '';
      }
      return tail ? sep : '';
    });
  }
}

async function run() {
  const client = new Client({
    connectionString: normalizeConnectionString(process.env.PAYROLL_DATABASE_URL),
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    const res = await client.query("SELECT id FROM employees WHERE name ILIKE '%REBECASUJI%'");
    if (res.rows.length === 0) {
      console.log('Not found');
      return;
    }
    const id = res.rows[0].id;
    console.log('Employee ID:', id);

    const apiRes = await fetch('http://localhost:5002/api/payroll-items/external-data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        employeeIds: [id],
        month: 4,
        year: 2026
      })
    });
    const data = await apiRes.json();
    console.log(JSON.stringify(data, null, 2));

  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}
run();
