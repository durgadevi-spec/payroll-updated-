import { Client } from 'pg';
import dotenv from 'dotenv';
dotenv.config({ path: './.env' });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const timesheetUrl = process.env.TIMESTRAP_DATABASE_URL || process.env.TIMESHEET_DATABASE_URL || process.env.DATABASE_URL;

async function main() {
  console.log('Connecting to Timesheet URL:', timesheetUrl ? 'FOUND' : 'MISSING');
  if (!timesheetUrl) return;

  const client = new Client({ connectionString: timesheetUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  
  console.log('--- Timesheet DB Tables ---');
  const tables = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
  console.log(tables.rows.map(t => t.table_name));

  // Check if timesheet_submissions or similar exists
  const hasSubmissions = tables.rows.some(t => t.table_name.includes('submission') || t.table_name.includes('timesheet'));
  if (hasSubmissions) {
    console.log('\n--- Timesheet Data Sample ---');
    // Try to find a table with 'timesheet' in it
    const tName = tables.rows.find(t => t.table_name.includes('timesheet'))?.table_name;
    if (tName) {
      const sample = await client.query(`SELECT * FROM ${tName} LIMIT 5`);
      console.log(`${tName} Sample:`, sample.rows);
    }
  }

  await client.end();
}
main().catch(console.error);
