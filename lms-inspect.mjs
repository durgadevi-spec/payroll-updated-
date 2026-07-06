import { Client } from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: './.env' });

const client = new Client({ connectionString: process.env.LMS_DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  await client.connect();
  const res = await client.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name`);
  console.log('tables:', res.rows.map(r => r.table_name));
  const table = 'employees';
  if (res.rows.some(r => r.table_name === table)) {
    const cols = await client.query(`SELECT column_name,data_type FROM information_schema.columns WHERE table_name=$1 ORDER BY ordinal_position`, [table]);
    console.log('employees columns:', cols.rows);
    const sample = await client.query(`SELECT * FROM employees LIMIT 1`);
    console.log('sample row count', sample.rowCount);
    if (sample.rowCount) console.log(sample.rows[0]);
  }
  await client.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
