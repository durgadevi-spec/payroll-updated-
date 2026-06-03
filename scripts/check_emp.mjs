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
    const res = await client.query('SELECT name, use_pa_sla, pa_sla_balance FROM employees WHERE name ILIKE $1', ['%REBECASUJI%']);
    console.log(res.rows);
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}
run();
