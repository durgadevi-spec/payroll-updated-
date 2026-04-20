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
  
  console.log('--- LMS Tables & Columns ---');
  const tables = ['employees', 'users', 'leaves'];
  for (const table of tables) {
    const res = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_name = $1`, [table]);
    console.log(`${table}:`, res.rows.map(r => r.column_name).join(', '));
  }

  console.log('\n--- Sample Users ---');
  const users = await client.query('SELECT * FROM users LIMIT 10');
  console.log(users.rows);

  await client.end();
}

main().catch(console.error);
