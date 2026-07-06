import pkg from 'pg';
const { Client } = pkg;
import * as dotenv from 'dotenv';
dotenv.config();
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const lmsUrl = process.env.LMS_DATABASE_URL;

async function run() {
  if (!lmsUrl) { console.log('No LMS URL'); return; }
  const client = new Client({ connectionString: lmsUrl, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
    
    console.log('--- Permissions Sample ---');
    const res1 = await client.query("SELECT user_id, username FROM permissions LIMIT 5");
    console.log(res1.rows);

    console.log('--- Users Sample ---');
    const res2 = await client.query("SELECT id, user_id, email FROM users LIMIT 5");
    console.log(res2.rows);

  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

run();
