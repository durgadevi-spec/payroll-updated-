require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.PAYROLL_DATABASE_URL });

async function run() {
    try {
        const res = await pool.query(
            "SELECT column_name FROM information_schema.columns WHERE table_name='payroll_items' AND column_name LIKE 'missing_punch_exception%'"
        );
        console.log('Found columns:', res.rows.map(r => r.column_name));
        if (res.rows.length === 3) {
            console.log('✅ All 3 columns exist — migration succeeded.');
        } else {
            console.log(`⚠️ Only ${res.rows.length} of 3 expected columns found.`);
        }
    } catch (err) {
        console.error('Error checking columns:', err);
    } finally {
        process.exit(0);
    }
}
run();
