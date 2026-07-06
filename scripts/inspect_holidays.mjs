import { Client } from 'pg';
import * as dotenv from 'dotenv';
dotenv.config();

function normalizeConnectionString(str) {
  try {
    const url = new URL(str);
    url.searchParams.delete('sslmode');
    return url.toString();
  } catch {
    return str.replace(/([?&])sslmode=(require|prefer|verify-ca)(&|$)/gi, (m, s, md, t) => s === '?' ? (t ? '?' : '') : (t ? s : ''));
  }
}

async function run() {
  const client = new Client({ connectionString: normalizeConnectionString(process.env.LMS_DATABASE_URL), ssl: { rejectUnauthorized: false } });
  await client.connect();
  const res = await client.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'holidays'");
  console.log(res.rows);
  await client.end();
}
run();
