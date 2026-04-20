const dotenv = require('dotenv');
const { Client } = require('pg');

dotenv.config({ path: './.env' });

const url = process.env.PAYROLL_DATABASE_URL;
if (!url) {
  console.error('PAYROLL_DATABASE_URL missing');
  process.exit(1);
}

const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });

(async () => {
  try {
    await client.connect();
    const res = await client.query('select count(*) from employees');
    console.log('raw payroll DB employee count:', res.rows[0].count);
  } catch (e) {
    console.error('ERROR', e.message || e);
    process.exit(1);
  } finally {
    await client.end();
  }
})();