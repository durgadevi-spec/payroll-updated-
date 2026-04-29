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
    
    const res3 = await client.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'employees'");
    console.log('--- LMS employees ---');
    console.log(JSON.stringify(res3.rows, null, 2));

    console.log('--- permissions ---');
    const res2 = await client.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'permissions'");
    console.log(JSON.stringify(res2.rows, null, 2));

  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

run();
