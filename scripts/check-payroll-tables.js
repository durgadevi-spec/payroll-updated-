import dotenv from 'dotenv';
import { Client } from 'pg';

dotenv.config({ path: './.env' });

const url = process.env.PAYROLL_DATABASE_URL;
const tables = [
  'employees',
  'payrolls',
  'payroll_items',
  'payslips',
  'leaves',
  'timesheets',
  'bonuses',
  'settings',
  'email_logs',
  'audit_logs',
];

if (!url) {
  console.error('PAYROLL_DATABASE_URL is not defined in .env');
  process.exit(1);
}

const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });

async function main() {
  await client.connect();
  console.log('Payroll DB tables:');
  for (const table of tables) {
    const res = await client.query(
      "select exists(select 1 from information_schema.tables where table_schema='public' and table_name=$1)",
      [table]
    );
    console.log(`${table}: ${res.rows[0].exists ? 'exists' : 'missing'}`);
  }
  await client.end();
}

main().catch(error => {
  console.error('ERROR:', error.message || error);
  process.exit(1);
});