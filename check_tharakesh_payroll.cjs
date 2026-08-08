require('dotenv').config();
const { Pool } = require('pg');
const payrollPool = new Pool({ connectionString: process.env.PAYROLL_DATABASE_URL });

async function run() {
  // 1. Employee record — confirm joining_date as actually stored
  const empRes = await payrollPool.query(
    `SELECT id, name, employee_code, ctc, joining_date, status FROM employees WHERE name ILIKE '%THARAKESH%'`
  );
  console.log('--- Employee record ---');
  console.log(empRes.rows);

  if (empRes.rows.length === 0) {
    console.log('No employee found matching THARAKESH. Check the name spelling.');
    process.exit(1);
  }
  const emp = empRes.rows[0];

  // 2. All payroll_items rows for this employee (across every generated version),
  //    joined with the payroll batch's month/year/version so we can see the full history.
  const itemsRes = await payrollPool.query(
    `SELECT pi.id AS payroll_item_id, p.month, p.year, p.version, p.generated_at,
            pi.monthly_salary, pi.calculation_type, pi.calculation_days, pi.working_days,
            pi.unpaid_leaves, pi.missing_timesheets, pi.missing_punches,
            pi.leave_deduction, pi.timesheet_deduction, pi.missing_punch_deduction,
            pi.pf_deduction, pi.esi_deduction, pi.tax_deduction,
            pi.net_salary
     FROM payroll_items pi
     JOIN payrolls p ON p.id = pi.payroll_id
     WHERE pi.employee_id = $1
     ORDER BY p.year DESC, p.month DESC, p.version DESC`,
    [emp.id]
  );
  console.log('\n--- All payroll_items rows for this employee (newest first) ---');
  console.table(itemsRes.rows);

  process.exit(0);
}
run().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
