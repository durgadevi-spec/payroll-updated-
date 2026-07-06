const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const envPath = path.join(__dirname, '..', '.env');
const envContent = fs.readFileSync(envPath, 'utf8');
const match = envContent.match(/TIMESTRAP_DATABASE_URL=(.*)/);
let connectionString = match ? match[1].trim() : null;

// Remove query params to prevent conflict with manual SSL config
if (connectionString) {
    connectionString = connectionString.split('?')[0];
}

async function checkSchema() {
  if (!connectionString) {
    console.error("Connection string not found in .env");
    return;
  }

  const client = new Client({
    connectionString: connectionString,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    const res = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'time_entries'
    `);
    console.log("COLUMNS_START");
    console.log(JSON.stringify(res.rows.map(r => r.column_name)));
    console.log("COLUMNS_END");
  } catch (err) {
    console.error("Error:", err);
  } finally {
    await client.end();
  }
}

checkSchema();
