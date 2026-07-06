require('dotenv').config();
const { Pool } = require('pg');
const tsPool = new Pool({ connectionString: process.env.TIMESTRAP_DATABASE_URL });

async function run() {
  const r = await tsPool.query(
    `SELECT DISTINCT CAST(date AS date) AS d 
     FROM time_entries 
     WHERE UPPER(employee_code) = 'E0057' 
       AND EXTRACT(MONTH FROM CAST(date AS date)) = 6 
       AND EXTRACT(YEAR FROM CAST(date AS date)) = 2026 
       AND LOWER(status) NOT IN ('draft', 'rejected') 
     ORDER BY d`
  );
  const dates = r.rows.map(row => {
    const dt = new Date(row.d);
    return dt.getFullYear() + '-' + String(dt.getMonth()+1).padStart(2,'0') + '-' + String(dt.getDate()).padStart(2,'0');
  });
  console.log('Sivakumar properly submitted (non-draft) worked dates in June 2026:', dates);
  console.log('Total worked days:', dates.length);

  // Now calculate missing days (working days in June 2026 = Mon-Sat excl Sundays and holidays)
  const calDays = new Date(2026, 6, 0).getDate(); // 30 days in June
  const workedSet = new Set(dates);
  const missing = [];
  for (let d = 1; d <= calDays; d++) {
    const dt = new Date(2026, 5, d);
    const ds = '2026-06-' + String(d).padStart(2,'0');
    if (dt.getDay() === 0) continue; // skip Sunday
    if (!workedSet.has(ds)) missing.push(ds);
  }
  console.log('\nMissing days (working days without submitted TS):', missing);
  console.log('Total missing:', missing.length);

  process.exit(0);
}
run().catch(e => { console.error(e.message); process.exit(1); });
