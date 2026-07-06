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
    
    console.log('--- LMS users ---');
    const res = await client.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'users'");
    console.log(JSON.stringify(res.rows, null, 2));

  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

run();
