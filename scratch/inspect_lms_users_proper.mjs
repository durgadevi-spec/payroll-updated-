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
  
  const res = await client.query(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'users' AND table_schema = 'public'
  `);
  console.log('Columns:', res.rows);

  const sample = await client.query('SELECT * FROM users LIMIT 1');
  console.log('\nKeys:', Object.keys(sample.rows[0]));

  await client.end();
}

main().catch(console.error);
