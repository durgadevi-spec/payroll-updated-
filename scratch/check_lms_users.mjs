import { Client } from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: './.env' });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const client = new Client({ 
  connectionString: process.env.LMS_DATABASE_URL, 
  ssl: { rejectUnauthorized: false } 
});

async function main() {
  await client.connect();
  
  const res = await client.query('SELECT count(*) FROM users');
  console.log('Total users in LMS:', res.rows[0].count);

  const sample = await client.query('SELECT id, username, user_id, email FROM users LIMIT 5');
  console.log('Sample Users:', sample.rows);

  await client.end();
}

main().catch(console.error);
