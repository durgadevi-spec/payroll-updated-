require('dotenv').config();
const { Pool } = require('pg');

const lmsPool = new Pool({ connectionString: process.env.LMS_DATABASE_URL });
const tsPool = new Pool({ connectionString: process.env.TIMESTRAP_DATABASE_URL });

async function run() {
  const lmsClient = await lmsPool.connect();
  const tsClient = await tsPool.connect();

  const month = 5;
  const year = 2026;
  const name = 'test empolyee';
  const code = 'E0041';
  
  // 1. Fetch Leaves
  const leaveQuery = `
    SELECT 
      d::date AS leave_date,
      l.leave_type,
      l.leave_duration_type
    FROM leaves l
    LEFT JOIN employees e ON e.employee_code = l.user_id
    CROSS JOIN LATERAL (
      SELECT CAST(d::date AS date) AS d FROM generate_series(
        CAST(l.start_date AS date),
        CAST(l.end_date AS date),
        '1 day'::interval
      ) d
    ) dates
    WHERE LOWER(l.status) = 'approved'
      AND EXTRACT(MONTH FROM d::date) = $1
      AND EXTRACT(YEAR FROM d::date) = $2
      AND (
        LOWER(TRIM(l.user_id)) = LOWER(TRIM($4))
        OR LOWER(TRIM(e.name)) = LOWER(TRIM($3))
        OR (e.name ILIKE $3 || '%')
        OR ($3 ILIKE e.name || '%')
      )
  `;
  const leaveRes = await lmsClient.query(leaveQuery, [month, year, name, code]);
  const allLeaveDates = [];
  const odDates = [];
  let unpaidCount = 0;
  for (const row of leaveRes.rows) {
    // using local time to format string correctly
    const dObj = new Date(row.leave_date);
    const d = new Date(dObj.getTime() - dObj.getTimezoneOffset() * 60000).toISOString().split('T')[0];
    allLeaveDates.push(d);
    if (row.leave_type === 'OD') odDates.push(d);
    else unpaidCount++;
  }
  const leaveDateSet = new Set(allLeaveDates);

  console.log('--- LEAVES ---');
  console.log('Leaves from DB:', leaveRes.rows.map(r => r.leave_date));
  console.log('Parsed Leave Dates:', allLeaveDates);

  // 2. Fetch Timesheet
  const candidateCodes = ['E0041'];
  const tsRes = await tsClient.query(
    `SELECT ARRAY_AGG(DISTINCT CAST(date as date)) as worked_dates 
     FROM time_entries 
     WHERE UPPER(employee_code) = ANY($1) AND EXTRACT(MONTH FROM CAST(date as date)) = $2 AND EXTRACT(YEAR FROM CAST(date as date)) = $3`,
    [candidateCodes, month, year]
  );
  
  console.log('\\n--- TIMESHEET ---');
  let workedDatesSet = new Set();
  if (tsRes.rows.length > 0 && tsRes.rows[0].worked_dates) {
    const workedDates = tsRes.rows[0].worked_dates.map(d => {
      const dObj = new Date(d);
      return new Date(dObj.getTime() - dObj.getTimezoneOffset() * 60000).toISOString().split('T')[0];
    });
    workedDatesSet = new Set(workedDates);
    console.log('Worked Dates:', workedDates);
  } else {
    console.log('No worked dates found!');
  }

  // 3. Compute Missing
  const calendarDays = new Date(year, month, 0).getDate();
  const rawMissingDates = [];
  const sundays = [];
  
  for (let d = 1; d <= calendarDays; d++) {
    // Note: use local time so timezone shift doesn't break
    const dstr = year + '-' + month.toString().padStart(2, '0') + '-' + d.toString().padStart(2, '0');
    const dt = new Date(year, month - 1, d); // local time
    
    if (dt.getDay() === 0) {
      sundays.push(dstr);
      continue;
    }
    // ignore holidays for now in this script
    if (!workedDatesSet.has(dstr)) {
      rawMissingDates.push(dstr);
    }
  }

  console.log('\\n--- MISSING DATES ---');
  console.log('Sundays:', sundays);
  console.log('Raw Missing Dates:', rawMissingDates);

  const actualMissingDates = rawMissingDates.filter(d => !leaveDateSet.has(d));
  const excludedDates = rawMissingDates.filter(d => leaveDateSet.has(d));

  console.log('Excluded (Overlap):', excludedDates);
  console.log('Final Missing:', actualMissingDates);
  
  process.exit(0);
}
run();
