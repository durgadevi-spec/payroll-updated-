const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://postgres.ojqurkhomfjgtjctpdcl:Rebecasuji%4013@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres' });
const lmsPool = new Pool({ connectionString: 'postgresql://postgres.gykfyiqujyiwchqgmsjx:Rebecasuji%4013@aws-1-ap-southeast-2.pooler.supabase.com:6543/postgres' });
async function run() {
  try {
    const empRes = await pool.query(\"SELECT id, employee_code, name FROM employees WHERE name ILIKE '%NAVEEN%'\");
    const emp = empRes.rows[0];
    console.log('Employee:', emp.name, emp.employee_code);
    const attRes = await pool.query(
      \SELECT DISTINCT TO_CHAR(punch_time AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') as att_date FROM attendance_logs WHERE UPPER(emp_code) = UPPER(\) ORDER BY att_date\, [emp.employee_code]
    );
    console.log('Punched Dates:', attRes.rows.map((r) => r.att_date));
    const leaveRes = await lmsPool.query(
      \SELECT start_date, end_date, status, leave_type FROM leaves WHERE employee_id = \\, [emp.employee_code]
    );
    console.log('LMS Leaves:', leaveRes.rows);
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end(); await lmsPool.end();
  }
}
run();
