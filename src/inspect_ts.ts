import { Client } from 'pg';
import dotenv from 'dotenv';
dotenv.config();

async function checkSchema() {
  const client = new Client({
    connectionString: process.env.TIMESTRAP_DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    const res = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'time_entries'
    `);
    console.log("Columns in time_entries:");
    console.log(res.rows.map(r => r.column_name));
  } catch (err) {
    console.error("Error:", err);
  } finally {
    await client.end();
  }
}

checkSchema();
