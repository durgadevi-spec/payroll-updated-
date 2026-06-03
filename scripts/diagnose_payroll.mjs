import { Client } from 'pg';
import * as dotenv from 'dotenv';
dotenv.config();

function normalizeConnectionString(str) {
  try { const url = new URL(str); url.searchParams.delete('sslmode'); return url.toString(); } catch { return str; }
}

async function run() {
  const lmsClient = new Client({ connectionString: normalizeConnectionString(process.env.LMS_DATABASE_URL), ssl: { rejectUnauthorized: false } });
  const payrollClient = new Client({ connectionString: normalizeConnectionString(process.env.PAYROLL_DATABASE_URL), ssl: { rejectUnauthorized: false } });
  
  await lmsClient.connect();
  await payrollClient.connect();

  // 1. Check all distinct leave types in LMS
  console.log('\n=== ALL LEAVE TYPES IN LMS ===');
  const ltRes = await lmsClient.query("SELECT DISTINCT leave_type FROM leaves ORDER BY leave_type");
  console.log(ltRes.rows.map(r => r.leave_type));

  // 2. Check DurgaDevi leaves for June 2026
  console.log('\n=== DurgaDevi Leaves (June 2026) ===');
  const ddRes = await lmsClient.query(`
    SELECT l.leave_type, l.start_date, l.end_date, l.leave_duration_type, l.status,
           e.name, e.employee_code
    FROM leaves l
    JOIN employees e ON e.employee_code = l.user_id
    WHERE (LOWER(TRIM(e.name)) LIKE '%durga%' OR e.employee_code = 'E0048')
      AND l.status = 'Approved'
      AND (EXTRACT(MONTH FROM l.start_date) = 6 OR EXTRACT(MONTH FROM l.end_date) = 6)
      AND EXTRACT(YEAR FROM l.start_date) = 2026
  `);
  console.log(ddRes.rows);

  // 3. Check ALL leaves for June 2026 from LMS
  console.log('\n=== ALL Approved Leaves for June 2026 ===');
  const juneRes = await lmsClient.query(`
    SELECT l.leave_type, l.start_date, l.end_date, l.leave_duration_type, l.status, e.name, e.employee_code
    FROM leaves l
    JOIN employees e ON e.employee_code = l.user_id
    WHERE l.status = 'Approved'
      AND (EXTRACT(MONTH FROM l.start_date) = 6 OR EXTRACT(MONTH FROM l.end_date) = 6)
      AND EXTRACT(YEAR FROM l.start_date) = 2026
    ORDER BY e.name
  `);
  console.log(juneRes.rows);

  // 4. Check if timesheet_excluded_dates and holiday_dates columns exist and have data
  console.log('\n=== Payroll Items - Checking stored excluded/holiday dates ===');
  const piRes = await payrollClient.query(`
    SELECT pi.id, e.name, pi.missing_timesheets, pi.timesheet_excluded_dates, pi.holiday_dates,
           p.month, p.year
    FROM payroll_items pi
    JOIN employees e ON e.id = pi.employee_id
    JOIN payrolls p ON p.id = pi.payroll_id
    WHERE p.month = 6 AND p.year = 2026
    ORDER BY e.name
    LIMIT 20
  `);
  console.log('\nJune 2026 payroll items:');
  piRes.rows.forEach(r => {
    console.log(`  ${r.name}: missing_timesheets=${r.missing_timesheets}, excluded=${JSON.stringify(r.timesheet_excluded_dates)}, holidays=${JSON.stringify(r.holiday_dates)}`);
  });

  // Also check May
  const mayRes = await payrollClient.query(`
    SELECT pi.id, e.name, pi.missing_timesheets, pi.timesheet_excluded_dates, pi.holiday_dates,
           p.month, p.year
    FROM payroll_items pi
    JOIN employees e ON e.id = pi.employee_id
    JOIN payrolls p ON p.id = pi.payroll_id
    WHERE p.month = 5 AND p.year = 2026
    ORDER BY e.name
    LIMIT 20
  `);
  console.log('\nMay 2026 payroll items:');
  mayRes.rows.forEach(r => {
    console.log(`  ${r.name}: missing_timesheets=${r.missing_timesheets}, excluded=${JSON.stringify(r.timesheet_excluded_dates)}, holidays=${JSON.stringify(r.holiday_dates)}`);
  });

  await lmsClient.end();
  await payrollClient.end();
}

run().catch(console.error);
