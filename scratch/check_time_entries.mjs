import { Client } from 'pg';
import dotenv from 'dotenv';
dotenv.config({ path: './.env' });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const timesheetUrl = process.env.TIMESTRAP_DATABASE_URL || process.env.TIMESHEET_DATABASE_URL || process.env.DATABASE_URL;

async function main() {
  const client = new Client({ connectionString: timesheetUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  
  console.log('--- time_entries Sample ---');
  const sample = await client.query(`SELECT * FROM time_entries LIMIT 10`);
  console.log(sample.rows);

  // Check unique employee/user IDs in time_entries
  const users = await client.query(`SELECT DISTINCT user_id FROM time_entries`);
  console.log('\nUnique user_ids in time_entries:', users.rows);

  await client.end();
}
main().catch(console.error);
