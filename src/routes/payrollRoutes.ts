import { Router } from 'express';
import { Pool, Client } from 'pg';
import * as dotenv from 'dotenv';
import ZKLib from 'node-zklib';
import { sendEmail } from './emailRoutes';

dotenv.config({ path: './.env' });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const payrollUrl = process.env.PAYROLL_DATABASE_URL as string;
const lmsUrl = process.env.LMS_DATABASE_URL;
const timesheetUrl = process.env.TIMESTRAP_DATABASE_URL || process.env.TIMESHEET_DATABASE_URL || process.env.DATABASE_URL;
if (!payrollUrl) {
  throw new Error('PAYROLL_DATABASE_URL is required for payroll routes.');
}

function normalizeConnectionString(connectionString: string) {
  try {
    const url = new URL(connectionString);
    url.searchParams.delete('sslmode');
    return url.toString();
  } catch {
    return connectionString.replace(/([?&])sslmode=(require|prefer|verify-ca)(&|$)/gi, (match, sep, mode, tail) => {
      if (sep === '?') {
        return tail ? '?' : '';
      }
      return tail ? sep : '';
    });
  }
}

function getMonthName(month: number) {
  const names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return names[month - 1] || 'Unknown';
}

function createPool(connectionString: string) {
  const normalizedConnectionString = normalizeConnectionString(connectionString);
  return new Pool({
    connectionString: normalizedConnectionString,
    ssl: { rejectUnauthorized: false },
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  });
}

function createClient(connectionString: string) {
  const normalizedConnectionString = normalizeConnectionString(connectionString);
  return new Client({
    connectionString: normalizedConnectionString,
    ssl: { rejectUnauthorized: false },
  });
}

const payrollPool = createPool(payrollUrl);
const lmsPool = lmsUrl ? createPool(lmsUrl) : null;
const timesheetPool = timesheetUrl ? createPool(timesheetUrl) : null;

async function fetchIclockToken() {
  const authUrl = process.env.ILOCK_API_AUTH_URL || 'http://127.0.0.1:8000/api-token-auth/';
  const username = process.env.ILOCK_API_USERNAME;
  const password = process.env.ILOCK_API_PASSWORD;

  if (!username || !password) {
    throw new Error('ILOCK_API_TOKEN is not configured and ILOCK_API_USERNAME / ILOCK_API_PASSWORD are missing.');
  }

  const response = await fetch(authUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Attendance auth failed: ${body}`);
  }

  const body = await response.json();
  if (!body.token) {
    throw new Error('Attendance auth response did not return a token.');
  }

  return body.token as string;
}

async function getIclockToken() {
  if (process.env.ILOCK_API_TOKEN) return process.env.ILOCK_API_TOKEN;
  return fetchIclockToken();
}

function createPayrollClient() {
  return createClient(payrollUrl);
}

function createLmsClient() {
  return lmsUrl ? createClient(lmsUrl) : null;
}

function createTimesheetClient() {
  return timesheetUrl ? createClient(timesheetUrl) : null;
}

const router = Router();

// ─── Department Routes ────────────────────────────────────────────────────────

router.get('/departments', async (_req, res) => {
  let client;
  try {
    client = await payrollPool.connect();
    const result = await client.query('SELECT * FROM departments ORDER BY name ASC');
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching departments:', err);
    res.status(500).json({ error: 'Failed to fetch departments' });
  } finally {
    if (client) client.release();
  }
});

router.post('/departments', async (req, res) => {
  const { name, reporting_manager = '' } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Department name is required' });
  let client;
  try {
    client = await payrollPool.connect();
    const result = await client.query(
      `INSERT INTO departments (name, reporting_manager) VALUES ($1, $2) RETURNING *`,
      [name.trim(), reporting_manager.trim()]
    );
    res.status(201).json(result.rows[0]);
  } catch (err: any) {
    if (err.code === '23505') return res.status(409).json({ error: 'Department already exists' });
    console.error('Error creating department:', err);
    res.status(500).json({ error: 'Failed to create department' });
  } finally {
    if (client) client.release();
  }
});

router.put('/departments/:id', async (req, res) => {
  const { id } = req.params;
  const { name, reporting_manager = '' } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Department name is required' });
  let client;
  try {
    client = await payrollPool.connect();
    const result = await client.query(
      `UPDATE departments SET name=$1, reporting_manager=$2, updated_at=NOW() WHERE id=$3 RETURNING *`,
      [name.trim(), reporting_manager.trim(), id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Department not found' });
    res.json(result.rows[0]);
  } catch (err: any) {
    if (err.code === '23505') return res.status(409).json({ error: 'Department name already exists' });
    console.error('Error updating department:', err);
    res.status(500).json({ error: 'Failed to update department' });
  } finally {
    if (client) client.release();
  }
});

router.delete('/departments/:id', async (req, res) => {
  const { id } = req.params;
  let client;
  try {
    client = await payrollPool.connect();
    const result = await client.query('DELETE FROM departments WHERE id=$1 RETURNING name', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Department not found' });
    res.json({ success: true, name: result.rows[0].name });
  } catch (err) {
    console.error('Error deleting department:', err);
    res.status(500).json({ error: 'Failed to delete department' });
  } finally {
    if (client) client.release();
  }
});

// ─── Payroll Processing Routes ────────────────────────────────────────────────
router.get('/payroll-processing', async (req, res) => {
  const { month, year } = req.query;
  if (!month || !year) return res.status(400).json({ error: 'Month and year are required' });

  let pClient: any, tClient: any;
  try {
    pClient = await payrollPool.connect();
    tClient = timesheetPool ? await timesheetPool.connect() : null;

    // 1. Get all active employees
    const empRes = await pClient.query('SELECT id, name, email, designation, department, employee_code, ctc FROM employees WHERE status = \'active\'');
    const employees = empRes.rows;

    // 2. Fetch current status from payslips
    const payslipRes = await pClient.query(
      `SELECT employee_id, ps.status, hold_reason 
       FROM payslips ps
       JOIN payrolls p ON ps.payroll_id = p.id
       WHERE p.month = $1 AND p.year = $2`,
      [month, year]
    );
    const payslipMap = new Map(payslipRes.rows.map((r: any) => [r.employee_id, r]));

    // 3. Aggregate data for each employee
    const now = new Date();
    const isCurrentMonth = Number(year) === now.getFullYear() && Number(month) === (now.getMonth() + 1);

    const startDate = new Date(Number(year), Number(month) - 1, 1);
    const lastDayOfMonth = new Date(Number(year), Number(month), 0);
    const endDate = isCurrentMonth ? now : lastDayOfMonth;

    const daysInMonth = endDate.getDate();
    const startDateStr = startDate.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];

    // Fetch holidays to exclude from missing days
    const holidayRes = await pClient.query(
      `SELECT date FROM holidays WHERE date >= $1 AND date <= $2`,
      [startDateStr, endDateStr]
    );
    const holidaySet = new Set(holidayRes.rows.map((r: any) => new Date(r.date).toISOString().split('T')[0]));

    // Calculate expected working days (excluding Sundays and Holidays)
    let expectedDays = 0;
    let curr = new Date(startDate);
    while (curr <= endDate) {
      const dStr = curr.toISOString().split('T')[0];
      const isSunday = curr.getDay() === 0;
      if (!isSunday && !holidaySet.has(dStr)) {
        expectedDays++;
      }
      curr.setDate(curr.getDate() + 1);
    }

    // Fetch LMS data in bulk for the month
    let leaveMap = new Map();
    let permMap = new Map();
    if (lmsPool) {
      const lClient = await lmsPool.connect();
      try {
        // Fetch User/Employee mapping from LMS to match by Email if code fails
        const userRes = await lClient.query('SELECT user_id, email, username FROM users');
        const lmsUserMap = new Map(); // code -> email
        const lmsEmailMap = new Map(); // email -> code
        userRes.rows.forEach((u: any) => {
          if (u.user_id) {
            const c = u.user_id.toUpperCase();
            if (u.email) {
              lmsUserMap.set(c, u.email.toLowerCase());
              lmsEmailMap.set(u.email.toLowerCase(), c);
            }
          }
        });

        // 1. Calculate Leaves from 'leaves' table (more accurate than summary)
        const lRes = await lClient.query(
          `SELECT user_id, start_date, end_date 
           FROM leaves 
           WHERE status = 'Approved' 
             AND start_date <= $1 AND end_date >= $2`,
          [endDateStr, startDateStr]
        );

        lRes.rows.forEach((row: any) => {
          const code = (row.user_id || '').toUpperCase();
          const email = lmsUserMap.get(code);

          let curr = new Date(Math.max(new Date(row.start_date).getTime(), startDate.getTime()));
          const end = new Date(Math.min(new Date(row.end_date).getTime(), endDate.getTime()));

          let count = 0;
          while (curr <= end) {
            count++;
            curr.setDate(curr.getDate() + 1);
          }

          if (code) leaveMap.set(code, (leaveMap.get(code) || 0) + count);
          if (email) leaveMap.set(email, (leaveMap.get(email) || 0) + count);
        });

        // 2. Permissions
        const pRes = await lClient.query(
          `SELECT user_id, SUM(total_hours) as total 
           FROM permissions 
           WHERE permission_date >= $1 AND permission_date <= $2 AND status = 'Approved'
           GROUP BY user_id`,
          [startDateStr, endDateStr]
        );
        pRes.rows.forEach((r: any) => {
          const code = (r.user_id || '').toUpperCase();
          const email = lmsUserMap.get(code);
          const total = Number(r.total);
          if (code) permMap.set(code, (permMap.get(code) || 0) + total);
          if (email) permMap.set(email, (permMap.get(email) || 0) + total);
        });

      } catch (err) {
        console.error('Error fetching LMS data for dashboard:', err);
      } finally {
        lClient.release();
      }
    }

    // Fetch Biometric Present Days in bulk
    const bioRes = await pClient.query(
      `SELECT emp_code, COUNT(DISTINCT CAST(punch_time AS date)) as days 
       FROM attendance_logs 
       WHERE CAST(punch_time AS date) >= $1 AND CAST(punch_time AS date) <= $2
       GROUP BY emp_code`,
      [startDateStr, endDateStr]
    );
    const bioMap = new Map(bioRes.rows.map((r: any) => [(r.emp_code || '').toUpperCase(), Number(r.days)]));

    // Robust code resolution
    let tsCodeMap = new Map();
    let tsNameMap = new Map();
    if (tClient) {
      const tsEmpRes = await tClient.query('SELECT name, email, employee_code FROM employees');
      tsEmpRes.rows.forEach((r: any) => {
        if (r.employee_code) {
          const code = r.employee_code.toUpperCase();
          if (r.email) tsCodeMap.set(r.email.toLowerCase(), code);
          if (r.name) tsNameMap.set(r.name.toLowerCase().trim(), code);
        }
      });
    }

    const results = await Promise.all(employees.map(async (emp: any) => {
      let totalHours = 0;
      let recordedDays = 0;

      const resolveCode = () => {
        if (emp.employee_code) return emp.employee_code.toUpperCase();
        const emailKey = (emp.email || '').toLowerCase();
        const nameKey = (emp.name || '').toLowerCase().trim();
        return tsCodeMap.get(emailKey) || tsNameMap.get(nameKey) || null;
      };

      const code = resolveCode();
      const emailKey = (emp.email || '').toLowerCase();

      if (tClient && code) {
        try {
          const tsRes = await tClient.query(
            `SELECT total_hours 
             FROM time_entries 
             WHERE employee_code = $1 AND CAST(date AS date) >= $2 AND CAST(date AS date) <= $3`,
            [code, startDateStr, endDateStr]
          );

          let totalMinutes = 0;
          tsRes.rows.forEach((r: any) => {
            const hMatch = (r.total_hours || '').match(/(\d+)h/);
            const mMatch = (r.total_hours || '').match(/(\d+)m/);
            let mins = (hMatch ? parseInt(hMatch[1]) * 60 : 0) + (mMatch ? parseInt(mMatch[1]) : 0);

            // Standard cap: 8 hours work (1 hr break already deducted or excluded)
            // Capping at 8 hours (480 mins) per day unless OT is implemented
            if (mins > 480) mins = 480;

            totalMinutes += mins;
          });

          totalHours = totalMinutes / 60;
          recordedDays = tsRes.rows.length;
        } catch (e) {
          console.error(`Error fetching TS for ${code}:`, e);
        }
      }

      const ps = payslipMap.get(emp.id) as any;
      const leaveDays = leaveMap.get(code) || leaveMap.get(emailKey) || 0;
      const permissionHours = permMap.get(code) || permMap.get(emailKey) || 0;
      const biometricDays = bioMap.get(code) || 0;
      const missingDays = Math.max(0, expectedDays - recordedDays);

      // Salary Calculation
      const monthlySalary = (Number(emp.ctc || 0) / 12);
      const calendarDays = new Date(Number(year), Number(month), 0).getDate();
      const dayRate = monthlySalary / calendarDays;

      // Basic Net Calculation (Monthly Salary - (Missing Days * Day Rate) - (Leave Days * Day Rate))
      const projectedNetSalary = Math.max(0, monthlySalary - (missingDays * dayRate) - (leaveDays * dayRate));

      return {
        ...emp,
        totalHours: totalHours.toFixed(1),
        recordedDays,
        missingDays,
        biometricDays,
        leaveDays,
        permissionHours,
        monthlySalary: Math.round(monthlySalary),
        projectedNetSalary: Math.round(projectedNetSalary),
        status: ps?.status || 'NOT_GENERATED',
        holdReason: ps?.hold_reason || null
      };
    }));

    res.json(results);
  } catch (err) {
    console.error('Error in payroll-processing:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    if (pClient) pClient.release();
    if (tClient) tClient.release();
  }
});

router.post('/payroll-processing/hold', async (req, res) => {
  const { employeeId, month, year, reason } = req.body;
  if (!employeeId || !reason) return res.status(400).json({ error: 'Employee ID and reason are required' });

  let client;
  try {
    client = await payrollPool.connect();

    // Find the payslip for this employee and month
    const psRes = await client.query(
      `SELECT ps.id, e.email, e.name 
       FROM payslips ps
       JOIN payrolls p ON ps.payroll_id = p.id
       JOIN employees e ON ps.employee_id = e.id
       WHERE ps.employee_id = $1 AND p.month = $2 AND p.year = $3`,
      [employeeId, month, year]
    );

    if (psRes.rows.length === 0) {
      return res.status(404).json({ error: 'Payslip not found for this period. Please generate payroll first.' });
    }

    const { id: payslipId, email, name } = psRes.rows[0];

    // Update status and reason
    await client.query(
      'UPDATE payslips SET status = \'held\', hold_reason = $1 WHERE id = $2',
      [reason, payslipId]
    );

    try {
      const subject = `Salary Hold Notification - ${getMonthName(Number(month))} ${year}`;
      const html = `
        <div style="font-family: sans-serif; padding: 20px; color: #334155;">
          <h2 style="color: #1e40af;">Salary Hold Notification</h2>
          <p>Dear ${name},</p>
          <p>This is to inform you that your salary for <b>${getMonthName(Number(month))} ${year}</b> has been put on hold by the administration.</p>
          <div style="background: #f1f5f9; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <p style="margin: 0; font-weight: bold; color: #64748b; font-size: 12px; text-transform: uppercase;">Reason for Hold:</p>
            <p style="margin: 10px 0 0 0; color: #1e293b;">${reason}</p>
          </div>
          <p>Please contact the HR or Finance department for further clarification.</p>
          <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;">
          <p style="font-size: 12px; color: #94a3b8;">This is an automated notification from the Payroll System.</p>
        </div>
      `;
      await sendEmail({ to: email, subject, html, text: subject });
    } catch (emailErr) {
      console.error('Failed to send hold email for:', email, emailErr);
      // We don't fail the whole request if email fails, but maybe log it
    }

    res.json({ success: true, message: 'Salary held and notification sent' });
  } catch (err) {
    console.error('Error holding salary:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    if (client) client.release();
  }
});

router.post('/payroll-processing/release', async (req, res) => {
  const { employeeId, month, year } = req.body;
  let client;
  try {
    client = await payrollPool.connect();
    await client.query(
      `UPDATE payslips SET status = 'draft', hold_reason = NULL 
       WHERE employee_id = $1 AND payroll_id IN (SELECT id FROM payrolls WHERE month=$2 AND year=$3)`,
      [employeeId, month, year]
    );
    res.json({ success: true, message: 'Salary released' });
  } catch (err) {
    console.error('Error releasing salary:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    if (client) client.release();
  }
});

router.get('/holidays', async (_req, res) => {
  let client;
  try {
    client = await payrollPool.connect();
    const result = await client.query('SELECT * FROM holidays ORDER BY date ASC');
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching holidays:', err);
    res.status(500).json({ error: 'Failed to fetch holidays' });
  } finally {
    if (client) client.release();
  }
});

router.post('/holidays', async (req, res) => {
  const { date, name } = req.body;
  if (!date || !name?.trim()) return res.status(400).json({ error: 'Date and name are required' });
  let client;
  try {
    client = await payrollPool.connect();
    const result = await client.query(
      `INSERT INTO holidays (date, name) VALUES ($1, $2) RETURNING *`,
      [date, name.trim()]
    );
    res.status(201).json(result.rows[0]);
  } catch (err: any) {
    if (err.code === '23505') return res.status(409).json({ error: 'Holiday already exists for this date' });
    console.error('Error creating holiday:', err);
    res.status(500).json({ error: 'Failed to create holiday' });
  } finally {
    if (client) client.release();
  }
});

router.delete('/holidays/:id', async (req, res) => {
  const { id } = req.params;
  let client;
  try {
    client = await payrollPool.connect();
    const result = await client.query('DELETE FROM holidays WHERE id=$1 RETURNING name', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Holiday not found' });
    res.json({ success: true, name: result.rows[0].name });
  } catch (err) {
    console.error('Error deleting holiday:', err);
    res.status(500).json({ error: 'Failed to delete holiday' });
  } finally {
    if (client) client.release();
  }
});

// ─── Employee Routes ──────────────────────────────────────────────────────────

router.get('/employees', async (_req, res) => {
  let client;
  try {
    client = await payrollPool.connect();
    console.log('Fetching employees from payroll DB...');
    const result = await client.query('SELECT * FROM employees ORDER BY created_at DESC');
    console.log(`Found ${result.rows.length} employees`);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching employees:', error);
    res.json([]);
  } finally {
    if (client) client.release();
  }
});

router.post('/employees', async (req, res) => {
  const {
    name,
    email,
    employee_code = '',
    ctc,
    reporting_manager = '',
    department = '',
    designation = '',
    joining_date = null,
    bank_name = '',
    bank_account = '',
    ifsc_code = '',
    pf_number = '',
    esi_number = '',
    uan_number = '',
    status = 'active',
    use_pa_sla = false,
    pa_sla_balance = 0,
  } = req.body;

  const validJoiningDate = joining_date && joining_date !== "" ? joining_date : null;

  let client;
  try {
    client = await payrollPool.connect();
    const insert = await client.query(
      `INSERT INTO employees (name, email, employee_code, ctc, reporting_manager, department, designation, joining_date, bank_name, bank_account, ifsc_code, pf_number, esi_number, uan_number, status, use_pa_sla, pa_sla_balance)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) RETURNING *`,
      [name, email, employee_code || null, ctc, reporting_manager, department, designation, validJoiningDate, bank_name, bank_account, ifsc_code, pf_number, esi_number, uan_number, status, use_pa_sla, pa_sla_balance]
    );

    const employee = insert.rows[0];
    await client.query(
      `INSERT INTO audit_logs (action, entity, entity_id, details, user_email) VALUES ($1,$2,$3,$4,$5)`,
      ['CREATE_EMPLOYEE', 'employees', employee.id, JSON.stringify({ name, email }), 'admin@company.com']
    );

    res.status(201).json(employee);
  } catch (error) {
    console.error('Error creating employee:', error);
    res.status(500).json({ error: 'Failed to create employee' });
  } finally {
    if (client) client.release();
  }
});

router.put('/employees/:id', async (req, res) => {
  const { id } = req.params;
  const {
    name,
    email,
    employee_code = '',
    ctc,
    reporting_manager = '',
    department = '',
    designation = '',
    joining_date = null,
    bank_name = '',
    bank_account = '',
    ifsc_code = '',
    pf_number = '',
    esi_number = '',
    uan_number = '',
    status = 'active',
    use_pa_sla = false,
    pa_sla_balance = 0,
  } = req.body;

  const validJoiningDate = joining_date && joining_date !== "" ? joining_date : null;

  let client;
  try {
    client = await payrollPool.connect();
    const update = await client.query(
      `UPDATE employees SET name=$1, email=$2, employee_code=$3, ctc=$4, reporting_manager=$5, department=$6, designation=$7, joining_date=$8, bank_name=$9, bank_account=$10, ifsc_code=$11, pf_number=$12, esi_number=$13, uan_number=$14, status=$15, use_pa_sla=$16, pa_sla_balance=$17, updated_at=NOW()
       WHERE id=$18 RETURNING *`,
      [name, email, employee_code || null, ctc, reporting_manager, department, designation, validJoiningDate, bank_name, bank_account, ifsc_code, pf_number, esi_number, uan_number, status, use_pa_sla, pa_sla_balance, id]
    );

    const employee = update.rows[0];
    await client.query(
      `INSERT INTO audit_logs (action, entity, entity_id, details, user_email) VALUES ($1,$2,$3,$4,$5)`,
      ['UPDATE_EMPLOYEE', 'employees', id, JSON.stringify({ name, email }), 'admin@company.com']
    );

    res.json(employee);
  } catch (error) {
    console.error('Error updating employee:', error);
    res.status(500).json({ error: 'Failed to update employee' });
  } finally {
    if (client) client.release();
  }
});

router.delete('/employees/:id', async (_req, res) => {
  const { id } = _req.params;
  let client;
  try {
    client = await payrollPool.connect();
    const employeeResult = await client.query('SELECT * FROM employees WHERE id=$1', [id]);
    const employee = employeeResult.rows[0];
    await client.query('DELETE FROM employees WHERE id=$1', [id]);
    await client.query(
      `INSERT INTO audit_logs (action, entity, entity_id, details, user_email) VALUES ($1,$2,$3,$4,$5)`,
      ['DELETE_EMPLOYEE', 'employees', id, JSON.stringify({ name: employee?.name, email: employee?.email }), 'admin@company.com']
    );
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting employee:', error);
    res.status(500).json({ error: 'Failed to delete employee' });
  } finally {
    if (client) client.release();
  }
});

router.post('/employees/sync-timesheet', async (_req, res) => {
  let timesheetClient, payrollClient;
  try {
    timesheetClient = await timesheetPool?.connect();
    payrollClient = await payrollPool.connect();

    const result = await timesheetClient!.query('SELECT * FROM employees');

    const inserted = [];
    const updated = [];

    for (const row of result.rows) {
      const {
        id,
        name,
        email,
        salary,
        department,
        designation,
        joining_date,
        bank_name,
        bank_account,
        ifsc_code,
        pf_number,
        esi_number,
        uan_number,
        status,
      } = row;

      if (!email) continue;

      const upsert = await payrollClient.query(
        `INSERT INTO employees (id, name, email, ctc, department, designation, joining_date, bank_name, bank_account, ifsc_code, pf_number, esi_number, uan_number, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (email) DO UPDATE SET
           name = COALESCE(NULLIF(EXCLUDED.name, ''), employees.name),
           ctc = COALESCE(NULLIF(employees.ctc, 0), EXCLUDED.ctc),
           department = COALESCE(NULLIF(EXCLUDED.department, ''), employees.department),
           designation = COALESCE(NULLIF(EXCLUDED.designation, ''), employees.designation),
           joining_date = COALESCE(EXCLUDED.joining_date, employees.joining_date),
           bank_name = COALESCE(NULLIF(EXCLUDED.bank_name, ''), employees.bank_name),
           bank_account = COALESCE(NULLIF(EXCLUDED.bank_account, ''), employees.bank_account),
           ifsc_code = COALESCE(NULLIF(EXCLUDED.ifsc_code, ''), employees.ifsc_code),
           pf_number = COALESCE(NULLIF(EXCLUDED.pf_number, ''), employees.pf_number),
           esi_number = COALESCE(NULLIF(EXCLUDED.esi_number, ''), employees.esi_number),
           uan_number = COALESCE(NULLIF(EXCLUDED.uan_number, ''), employees.uan_number),
           status = EXCLUDED.status,
           updated_at = NOW()
         RETURNING *`,
        [id, name || '', email, salary || 0, department || '', designation || '', joining_date || null, bank_name || '', bank_account || '', ifsc_code || '', pf_number || '', esi_number || '', uan_number || '', status || 'active']
      );

      const employee = upsert.rows[0];
      if (employee.email === email && employee.name === name) {
        inserted.push(employee);
      } else {
        updated.push(employee);
      }
    }

    res.json({ inserted: inserted.length, updated: updated.length, total: result.rowCount });
  } catch (error) {
    console.error('Error syncing employees from timesheet DB:', error);
    res.status(500).json({ error: 'Failed to sync employees' });
  } finally {
    if (timesheetClient) timesheetClient.release();
    if (payrollClient) payrollClient.release();
  }
});

router.post('/employees/sync-biometric', async (req, res) => {
  const baseUrl = process.env.ILOCK_API_URL ? new URL(process.env.ILOCK_API_URL).origin : 'http://127.0.0.1:8001';
  const apiUrl = `${baseUrl}/personnel/api/employees/`;
  const limit = Number(req.query.limit || '1000');

  let client;
  try {
    const token = await getIclockToken();
    const url = new URL(apiUrl);
    if (limit > 0) url.searchParams.set('limit', String(limit));

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Token ${token}`,
      },
    });

    if (!response.ok) {
      const body = await response.text();
      return res.status(response.status).json({ error: `Employee fetch failed: ${body}` });
    }

    const data = await response.json();
    let records = [];
    if (Array.isArray(data)) {
      records = data;
    } else if (Array.isArray(data.results)) {
      records = data.results;
    } else {
      records = [data];
    }

    client = await payrollPool.connect();
    let newCount = 0;
    let updatedCount = 0;

    for (const record of records) {
      const emp_code = record.emp_code;
      const first_name = record.first_name || '';
      const last_name = record.last_name || '';
      const name = `${first_name} ${last_name}`.trim() || emp_code;
      const email = record.email || `${emp_code}@company.com`; // Fallback email
      const department = record.department?.name || '';
      const status = record.is_active === false ? 'inactive' : 'active';

      if (!emp_code) continue;

      // Upsert employee using emp_code as unique identifier or just email
      // Assuming email is unique in the employees table
      const upsert = await client.query(
        `INSERT INTO employees (name, email, department, status, designation)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (email) DO UPDATE SET
           name = EXCLUDED.name,
           department = EXCLUDED.department,
           status = EXCLUDED.status,
           updated_at = NOW()
         RETURNING *`,
        [name, email, department, status, record.position?.name || '']
      );

      // We can't strictly tell if inserted or updated with ON CONFLICT if we don't compare, 
      // but let's just count them all as synced.
      newCount++;
    }

    return res.json({ success: true, message: `Successfully synced ${newCount} employees from biometric.`, count: newCount });
  } catch (error) {
    console.error('Error syncing employees from biometric API:', error);
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to sync biometric employees' });
  } finally {
    if (client) client.release();
  }
});

router.get('/diagnose-lms', async (req, res) => {
  const { employee_code, month, year, name } = req.query;
  if (!employee_code || !month || !year) {
    return res.status(400).json({ error: 'Missing employee_code, month, or year' });
  }

  let lmsClient;
  try {
    if (!lmsPool) return res.status(503).json({ error: 'LMS pool not configured' });
    lmsClient = await lmsPool.connect();

    // Step 1: Check if employee exists in LMS
    const empRes = await lmsClient.query(
      `SELECT id, name, employee_code FROM employees WHERE LOWER(TRIM(employee_code)) = LOWER(TRIM($1))${name ? ` OR LOWER(TRIM(name)) = LOWER(TRIM($2))` : ''}`,
      name ? [employee_code, name] : [employee_code]
    );

    // Step 2: Check raw leaves for this employee_code
    const rawLeavesRes = await lmsClient.query(
      `SELECT l.id, l.user_id, l.leave_type, l.status, l.start_date, l.end_date, l.leave_duration_type
       FROM leaves l
       WHERE LOWER(TRIM(l.user_id)) = LOWER(TRIM($1))`,
      [employee_code]
    );

    // Step 3: Run the actual leave query used in payroll
    const leaveQuery = `
      SELECT 
        d::date AS leave_date,
        l.leave_type,
        l.leave_duration_type,
        l.status
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
        )
    `;
    const leaveRes = await lmsClient.query(leaveQuery, [month, year, name || '', employee_code]);

    return res.json({
      lms_employee_match: empRes.rows,
      raw_leaves_for_code: rawLeavesRes.rows,
      payroll_query_results: leaveRes.rows,
      summary: {
        employee_found_in_lms: empRes.rows.length > 0,
        total_raw_leaves: rawLeavesRes.rows.length,
        approved_leave_dates_in_month: leaveRes.rows.length,
        leave_dates: leaveRes.rows.map((r: any) => { const dt = new Date(r.leave_date); const ds = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`; return { date: ds, type: r.leave_type, status: r.status }; })
      }
    });
  } catch (err) {
    console.error('[DIAGNOSE-LMS] Error:', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Diagnose failed' });
  } finally {
    if (lmsClient) lmsClient.release();
  }
});


router.post('/payroll/generation-preview', async (req, res) => {
  const { employeeIds, month, year } = req.body;
  if (!employeeIds || !month || !year) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  let pClient, lmsClient, tsClient;
  try {
    pClient = await payrollPool.connect();
    lmsClient = lmsPool ? await lmsPool.connect() : null;
    tsClient = timesheetPool ? await timesheetPool.connect() : null;

    // Fetch employees
    const empRes = await pClient.query('SELECT id, name, email, employee_code, ctc, use_pa_sla, pa_sla_balance FROM employees WHERE id = ANY($1)', [employeeIds]);
    const employees = empRes.rows;

    // Helper to format date - Use UTC to avoid timezone shift
    const formatDate = (d: any) => {
      const dt = new Date(d);
      // Use UTC date parts to prevent timezone shifting
      return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
    };

    // Helper to format local date (for date strings from DB that are already date-only)
    const formatLocalDate = (d: any) => {
      if (typeof d === 'string' && d.length === 10) return d; // Already YYYY-MM-DD
      const dt = new Date(d);
      return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    };

    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0);

    // Fetch holidays - use UTC to avoid timezone shift
    const holRes = await pClient.query(
      `SELECT TO_CHAR(date AT TIME ZONE 'UTC', 'YYYY-MM-DD') as date_str FROM holidays WHERE EXTRACT(MONTH FROM date) = $1 AND EXTRACT(YEAR FROM date) = $2`,
      [month, year]
    );
    const holidaySet = new Set<string>(holRes.rows.map((r: any) => r.date_str));

    // Fetch LMS Leaves for all selected employees
    // Use TO_CHAR to return date as plain string (avoids JS Date UTC timezone shift in pg driver)
    const lmsLeaves = new Map(); // employee_id -> { date: { type, duration, paid } }
    if (lmsClient) {
      for (const emp of employees) {
        const leaveQuery = `
          SELECT TO_CHAR(d::date, 'YYYY-MM-DD') AS leave_date, l.leave_type, l.leave_duration_type
          FROM leaves l
          LEFT JOIN employees e ON e.employee_code = l.user_id
          CROSS JOIN LATERAL (
            SELECT d::date AS d FROM generate_series(CAST(l.start_date AS date), CAST(l.end_date AS date), '1 day'::interval) d
          ) dates
          WHERE LOWER(l.status) = 'approved'
            AND EXTRACT(MONTH FROM d::date) = $1
            AND EXTRACT(YEAR FROM d::date) = $2
            AND (LOWER(TRIM(l.user_id)) = LOWER(TRIM($4)) OR LOWER(TRIM(e.name)) = LOWER(TRIM($3)) OR (e.name ILIKE $3 || '%'))
        `;
        const lRes = await lmsClient.query(leaveQuery, [month, year, emp.name, emp.employee_code || '']);
        const empLeaves = new Map();

        for (const row of lRes.rows) {
          // leave_date is already 'YYYY-MM-DD' string from TO_CHAR — use directly, no Date conversion
          const dStr = row.leave_date as string;
          const isPaid = ['pl', 'sl', 'el', 'cl', 'sick', 'casual', 'earned', 'privilege', 'sick leave', 'casual leave', 'earned leave', 'privilege leave'].includes((row.leave_type || '').trim().toLowerCase());
          empLeaves.set(dStr, { type: row.leave_type || 'Unknown', isPaid, duration: row.leave_duration_type });
        }
        lmsLeaves.set(emp.id, empLeaves);
      }
    }

    // Fetch LMS Permissions for all selected employees (monthly batch)
    // permissions.user_id = employee_code; permission_date stored with IST offset → use TO_CHAR
    const lmsPermissions = new Map<string, Map<string, any>>(); // employee_id -> date -> { from, to, hours, type }
    if (lmsClient) {
      for (const emp of employees) {
        try {
          const permRes = await lmsClient.query(
            `SELECT
               TO_CHAR(permission_date AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS perm_date,
               permission_type,
               from_time,
               to_time,
               total_hours
             FROM permissions
             WHERE LOWER(status) = 'approved'
               AND is_lop_applicable = false
               AND EXTRACT(MONTH FROM permission_date AT TIME ZONE 'Asia/Kolkata') = $1
               AND EXTRACT(YEAR  FROM permission_date AT TIME ZONE 'Asia/Kolkata') = $2
               AND LOWER(TRIM(user_id)) = LOWER(TRIM($3))`,
            [month, year, emp.employee_code || '']
          );
          const empPerms = new Map<string, any>();
          for (const row of permRes.rows) {
            const dStr = row.perm_date as string;
            const existing = empPerms.get(dStr);
            const hrs = parseFloat(row.total_hours || '0');
            if (existing) {
              // Multiple permissions on same day → merge hours
              existing.hours += hrs;
              existing.to_time = row.to_time;
            } else {
              empPerms.set(dStr, {
                from_time: row.from_time,
                to_time: row.to_time,
                hours: hrs,
                type: row.permission_type
              });
            }
          }
          lmsPermissions.set(emp.id, empPerms);
        } catch (permErr: any) {
          console.warn('[PREVIEW] Permissions query failed:', permErr.message);
        }
      }
    }
    const timesheets = new Map<string, Set<string>>(); // employee_id -> Set of date strings
    if (tsClient) {
      // Get all submission dates for this month for the selected employees
      const empIdList = employees.map((e: any) => e.id);
      try {
        const tsRes = await tsClient.query(
          `SELECT employee_id, date FROM daily_submissions
           WHERE employee_id = ANY($1)
             AND EXTRACT(MONTH FROM date::date) = $2
             AND EXTRACT(YEAR FROM date::date) = $3`,
          [empIdList, month, year]
        );
        for (const row of tsRes.rows) {
          const empId = row.employee_id;
          if (!timesheets.has(empId)) timesheets.set(empId, new Set<string>());
          timesheets.get(empId)!.add(formatLocalDate(row.date));
        }
      } catch (tsErr: any) {
        console.warn('[PREVIEW] Timesheet query failed:', tsErr.message);
        // Non-fatal — continue without timesheet data
      }
    }

    // Fetch Attendance Logs - use IST offset (+5:30) to get correct local date
    const attendance = new Map<string, Map<string, any>>(); // employee_id -> date -> { in, out, hours }
    const attRes = await pClient.query(
      `SELECT emp_code,
        TO_CHAR(punch_time AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') as att_date,
        MIN(punch_time) as first_punch,
        MAX(punch_time) as last_punch
       FROM attendance_logs
       WHERE punch_time >= $1 AND punch_time < $2
       GROUP BY emp_code, TO_CHAR(punch_time AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD')`,
      [startDate.toISOString(), new Date(year, month, 1).toISOString()]
    );

    // Map emp_code back to employee_id (att_date is already YYYY-MM-DD string from TO_CHAR)
    const empCodeToId = new Map<string, string>(employees.map((e: any) => [e.employee_code?.toUpperCase(), e.id]));
    for (const r of attRes.rows) {
      if (r.emp_code) {
        const empId = empCodeToId.get(r.emp_code?.toUpperCase());
        if (empId) {
          if (!attendance.has(empId)) attendance.set(empId, new Map());
          const dStr = r.att_date; // Already 'YYYY-MM-DD' string from TO_CHAR
          const pIn = new Date(r.first_punch);
          const pOut = new Date(r.last_punch);
          const hours = (pOut.getTime() - pIn.getTime()) / (1000 * 60 * 60);
          attendance.get(empId)!.set(dStr, { in: pIn, out: pOut, hours });
        }
      }
    }

    // Process Day-by-Day
    const result: { employees: any[] } = { employees: [] };
    for (const emp of employees) {
      const empData = {
        id: emp.id,
        name: emp.name,
        ctc: emp.ctc || 0,
        days: [] as any[],
        summary: {
          totalPayable: 0,
          paidLeaves: 0,
          unpaidDays: 0,
          punchMissing: 0,
          lessThan9: 0,
          sundayDeductions: 0,
          approvedPermissionHours: 0,
          monthlyAllowanceUsed: 0,
          permissionLimitExceededDays: 0,
          halfDayLeaves: 0
        }
      };
      const empLeaves = lmsLeaves.get(emp.id) || new Map();
      const empTs = timesheets.get(emp.id) || new Set();
      const empAtt = attendance.get(emp.id) || new Map();
      const empPerms = lmsPermissions.get(emp.id) || new Map();
      let paSlaBalance = emp.use_pa_sla ? Number(emp.pa_sla_balance || 0) : 0;

      // First pass: Calculate all days
      for (let d = 1; d <= endDate.getDate(); d++) {
        const curr = new Date(year, month - 1, d);
        // Use local date parts since curr is constructed with local year/month/day
        const dStr = `${curr.getFullYear()}-${String(curr.getMonth() + 1).padStart(2, '0')}-${String(curr.getDate()).padStart(2, '0')}`;
        const isSunday = curr.getDay() === 0;
        const isSaturday = curr.getDay() === 6;
        const isHoliday = holidaySet.has(dStr);
        const leave = empLeaves.get(dStr);
        const perm = empPerms.get(dStr);
        const hasTs = empTs.has(dStr);
        const att = empAtt.get(dStr);

        let attStatus = 'Missing Both Punches';
        let totalHours = 0;
        let punchIn = null;
        let punchOut = null;

        if (att) {
          punchIn = att.in;
          punchOut = att.out;
          totalHours = att.hours;
          if (punchIn.getTime() === punchOut.getTime()) {
            attStatus = 'Missing Punch Out';
            totalHours = 0;
          } else if (totalHours >= 9) {
            attStatus = 'Valid 9 Hours';
          } else {
            attStatus = 'Less Than 9 Hours';
          }
        }

        let lmsStatus = leave ? 'Approved' : 'None';
        let paidUnpaid = 'Unpaid';
        let isDeductible = false;
        let dedReason = null;

        let eligibleHours = totalHours;
        let halfDayHours = 0;
        let permHours = perm ? perm.hours : 0;
        let allowanceUsedToday = 0;

        if (isSunday || isHoliday) {
          paidUnpaid = 'Paid';
        } else if (leave && (!leave.duration || !leave.duration.toLowerCase().includes('half'))) {
          // Full Day Leave
          if (leave.type.toLowerCase() === 'od') {
            paidUnpaid = 'Paid (OD)';
          } else {
            if (paSlaBalance >= 1) {
              paSlaBalance -= 1;
              paidUnpaid = 'Paid Leave';
            } else {
              paidUnpaid = 'Unpaid Leave';
              isDeductible = true;
              dedReason = 'Unpaid Leave (' + leave.type + ')';
            }
          }
        } else {
          // Working Day or Half-Day Leave
          if (leave && leave.duration && leave.duration.toLowerCase().includes('half')) {
            if (paSlaBalance >= 0.5) {
              paSlaBalance -= 0.5;
              halfDayHours = 4;
            } else {
              halfDayHours = 0;
            }
          }
          eligibleHours += halfDayHours + permHours;

          if (totalHours > 0 || halfDayHours > 0 || permHours > 0) {
            if (eligibleHours < 9) {
              const shortfall = 9 - eligibleHours;
              const availableAllowance = 3 - empData.summary.monthlyAllowanceUsed;
              if (availableAllowance > 0) {
                allowanceUsedToday = Math.min(shortfall, availableAllowance);
                empData.summary.monthlyAllowanceUsed += allowanceUsedToday;
                eligibleHours += allowanceUsedToday;
              }
            }
          }

          if (eligibleHours >= 9) {
            paidUnpaid = 'Paid (Working)';
            if (allowanceUsedToday > 0) {
              dedReason = 'Within Monthly 3-Hour Permission Allowance - No Deduction';
            } else if (permHours > 0) {
              dedReason = 'Approved Permission - No Deduction';
            } else if (halfDayHours > 0) {
              dedReason = 'Approved Half-Day Leave - No Deduction';
            } else {
              dedReason = null;
            }
          } else {
            if (totalHours === 0 && permHours === 0 && halfDayHours === 0) {
              // User requirement: deduct salary for missing punch in & out if no LMS leave applied
              paidUnpaid = 'Unpaid (Missing Punches)';
              isDeductible = true;
              dedReason = attStatus + ' (Salary Deducted)';
            } else {
              paidUnpaid = halfDayHours > 0 ? 'Paid (Half Leave)' : 'Paid (Missing Punches)';
              isDeductible = false;
              if (allowanceUsedToday > 0 || empData.summary.monthlyAllowanceUsed >= 3) {
                dedReason = 'Monthly 3-Hour Permission Limit Exceeded (No Salary Deduction)';
              } else {
                dedReason = attStatus + ' (No Salary Deduction)';
              }
            }
          }
        }

        if (permHours > 0) empData.summary.approvedPermissionHours += permHours;
        if (halfDayHours > 0) empData.summary.halfDayLeaves++;
        if (isDeductible && dedReason === 'Monthly 3-Hour Permission Limit Exceeded - Deductible') {
          empData.summary.permissionLimitExceededDays++;
        }

        empData.days.push({
          date: dStr,
          day: curr.toLocaleDateString('en-US', { weekday: 'short' }),
          punch_in: punchIn ? punchIn.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '-',
          punch_out: punchIn && punchOut && punchIn.getTime() !== punchOut.getTime() ? punchOut.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '-',
          total_hours: totalHours.toFixed(1),
          required_hours: 9,
          attendance_status: isSunday || isHoliday ? 'N/A' : attStatus,
          timesheet_status: hasTs ? 'Submitted' : 'Missing',
          lms_leave_status: lmsStatus,
          leave_type: leave ? leave.type : '-',
          paid_unpaid: paidUnpaid,
          salary_deduction_applicable: isDeductible,
          deduction_reason: dedReason,
          sunday_sandwich: false,
          permission_status: perm ? 'Approved' : 'None',
          permission_from: perm?.from_time ? String(perm.from_time).substring(0, 5) : '-',
          permission_to: perm?.to_time ? String(perm.to_time).substring(0, 5) : '-',
          permission_hours: permHours.toFixed(1),
          monthly_permission_used: allowanceUsedToday.toFixed(2),
          monthly_permission_remaining: Math.max(0, 3 - empData.summary.monthlyAllowanceUsed).toFixed(2),
          half_day_leave_status: halfDayHours > 0 ? 'Approved (4h)' : 'None',
          eligible_hours: eligibleHours.toFixed(2)
        });
      }

      // Second pass: Sunday Sandwich Rule
      for (let i = 0; i < empData.days.length; i++) {
        const day = empData.days[i];
        if (day.day === 'Sun' && i > 0 && i < empData.days.length - 1) {
          const sat = empData.days[i - 1];
          const mon = empData.days[i + 1];
          // Rule: deduct Sunday ONLY when both Saturday and Monday are confirmed salary-deductible unpaid absence days
          if (sat.salary_deduction_applicable && mon.salary_deduction_applicable) {
            day.salary_deduction_applicable = true;
            day.sunday_sandwich = true;
            day.deduction_reason = 'Sunday Deducted - Sandwich Absence Rule';
            day.paid_unpaid = 'Unpaid Sandwich';
          }
        }
      }

      // Compute Summaries
      let dedCount = 0;
      for (const day of empData.days) {
        if (day.salary_deduction_applicable) {
          empData.summary.unpaidDays++;
          if (day.sunday_sandwich) empData.summary.sundayDeductions++;
          else if (day.attendance_status === 'Less Than 9 Hours') empData.summary.lessThan9++;
          else if (!day.paid_unpaid.includes('Leave')) empData.summary.punchMissing++;
        } else {
          empData.summary.totalPayable++;
          if (day.paid_unpaid.includes('Leave') && day.paid_unpaid.includes('Paid')) {
            empData.summary.paidLeaves++;
          }
        }
      }

      result.employees.push(empData);
    }

    res.json(result);
  } catch (error) {
    console.error('Error generating payroll preview:', error);
    res.status(500).json({ error: 'Failed to generate payroll preview' });
  } finally {
    if (pClient) pClient.release();
    if (lmsClient) lmsClient.release();
    if (tsClient) tsClient.release();
  }
});

router.post('/payroll-items/external-data', async (req, res) => {
  const { employeeIds, month, year } = req.body;

  const leaveMap: Record<string, { employee_id: string; unpaid_leaves: number; total_leaves: number; paid_leaves: number; leave_type: string; leave_dates: string[]; pa_sla_consumed?: number; od_dates?: string[]; permission_hours?: number; dates?: string[] }> = {};
  const timesheetMap: Record<string, { employee_id: string; missing_days: number; submitted_at: string | null; missing_dates: string[]; excluded_dates?: string[] }> = {};

  let pClient, lmsClient, timesheetClient;

  try {
    pClient = await payrollPool.connect();
    const namesRes = await pClient.query('SELECT id, name, email, employee_code, department, use_pa_sla, pa_sla_balance FROM employees WHERE id = ANY($1)', [employeeIds]);
    const empData = namesRes.rows;
    const settingsResult = await pClient.query('SELECT value FROM settings WHERE key = \'working_days\'');
    const workingDays = parseInt(settingsResult.rows[0]?.value || '26');
    // Fetch ALL holidays for the month (with optional department filter)
    const holidayRes = await pClient.query(
      `SELECT date, applicable_departments FROM holidays WHERE EXTRACT(MONTH FROM date) = $1 AND EXTRACT(YEAR FROM date) = $2`,
      [month, year]
    );
    // All holiday dates (global)
    const allHolidays: { date: string; applicable_departments: string[] | null }[] = holidayRes.rows.map((r: any) => {
      const dt = new Date(r.date);
      const dateStr = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
      return {
        date: dateStr,
        applicable_departments: r.applicable_departments || null
      };
    });
    const globalHolidays = allHolidays.filter(h => !h.applicable_departments || h.applicable_departments.length === 0).map(h => h.date);
    const holidayCount = globalHolidays.length;

    pClient.release();

    if (lmsPool) {
      lmsClient = await lmsPool.connect();
      for (const emp of empData) {
        try {
          // Fetch all approved leave dates with leave_type per date
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
              )
          `;
          console.log(`[EXTERNAL-DATA] Fetching leaves for ${emp.name} (code: ${emp.employee_code || 'N/A'})`);
          const leaveRes = await lmsClient.query(leaveQuery, [month, year, emp.name, emp.employee_code || '']);

          if (leaveRes.rows.length > 0) {
            // Separate OD dates from real leave dates
            const allLeaveDates: string[] = [];
            const odDates: string[] = [];
            let unpaidCount = 0;
            let totalCount = 0;
            const leaveTypeSummary: string[] = [];

            for (const row of leaveRes.rows) {
              const dt = new Date(row.leave_date);
              const d = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
              const dayValue = row.leave_duration_type === 'Half Day' ? 0.5 : 1.0;
              allLeaveDates.push(d);
              totalCount += dayValue;
              leaveTypeSummary.push(row.leave_type);

              if (row.leave_type === 'OD') {
                // Paid leaves: no salary deduction, but still overlaps with TS missing to exclude
                odDates.push(d);
              } else {
                // All other leave types (Casual, Sick, LWP, Comp Off, Earned) = unpaid
                unpaidCount += dayValue;
              }
            }

            const uniqueAllLeaveDates = [...new Set(allLeaveDates)];
            const originalUnpaid = unpaidCount;
            let actualUnpaid = originalUnpaid;
            let paSlaConsumed = 0;

            if (emp.use_pa_sla && Number(emp.pa_sla_balance) > 0) {
              const balance = Number(emp.pa_sla_balance);
              if (balance >= originalUnpaid) {
                actualUnpaid = 0;
                paSlaConsumed = originalUnpaid;
              } else {
                actualUnpaid = originalUnpaid - balance;
                paSlaConsumed = balance;
              }
            }

            const primaryLeaveType = leaveTypeSummary.find(t => t !== 'OD') || leaveTypeSummary[0] || 'Leave';

            console.log(`[EXTERNAL-DATA] ✅ ${emp.name}: ${totalCount} total leaves, ${originalUnpaid} unpaid (excl OD), ${odDates.length} OD dates, actual unpaid after PA/SLA: ${actualUnpaid}`);
            leaveMap[emp.id] = {
              employee_id: emp.id,
              unpaid_leaves: actualUnpaid,
              total_leaves: totalCount,
              paid_leaves: 0,
              leave_type: primaryLeaveType,
              leave_dates: uniqueAllLeaveDates,  // ALL leave dates (incl OD) for TS exclusion
              od_dates: odDates,
              pa_sla_consumed: paSlaConsumed,
              dates: uniqueAllLeaveDates,
              permission_hours: 0 // Will be updated below
            };
          } else {
            console.log(`[EXTERNAL-DATA] ❌ No leaves found for ${emp.name}`);
            leaveMap[emp.id] = {
              employee_id: emp.id,
              unpaid_leaves: 0,
              total_leaves: 0,
              paid_leaves: 0,
              leave_type: 'Leave',
              leave_dates: [],
              od_dates: [],
              pa_sla_consumed: 0,
              dates: [],
              permission_hours: 0 // Will be updated below
            };
          }

          // Fetch permissions for this employee
          const permQuery = `
            SELECT SUM(total_hours) as total
            FROM permissions p
            LEFT JOIN employees e ON e.employee_code = p.user_id
            WHERE LOWER(p.status) = 'approved'
              AND EXTRACT(MONTH FROM p.permission_date) = $1
              AND EXTRACT(YEAR FROM p.permission_date) = $2
              AND (
                LOWER(TRIM(p.user_id)) = LOWER(TRIM($4))
                OR LOWER(TRIM(e.name)) = LOWER(TRIM($3))
              )
          `;
          const permRes = await lmsClient.query(permQuery, [month, year, emp.name, emp.employee_code || '']);
          if (permRes.rows.length > 0 && permRes.rows[0].total) {
            const permHours = parseFloat(permRes.rows[0].total);
            console.log(`[EXTERNAL-DATA] ✅ ${emp.name} has ${permHours} permission hours.`);
            leaveMap[emp.id].permission_hours = permHours;
          }
        } catch (error) {
          console.error('Unable to fetch leaves for employee:', emp.name, error);
        }
      }
    }

    if (timesheetPool) {
      console.log(`[EXTERNAL-DATA] Querying timesheet for Month: ${month}, Year: ${year}`);
      timesheetClient = await timesheetPool.connect();

      const candidateMap = empData.map((e: any) => {
        const normalizedEmail = (e.email || '').toUpperCase();
        const normalizedName = (e.name || '').toUpperCase().trim();
        const normalizedEmpCode = (e.employee_code || '').toUpperCase();
        const codes = new Set<string>();
        if (e.name.includes('REBECA')) codes.add('E0046');
        if (normalizedEmpCode) codes.add(normalizedEmpCode);
        if (normalizedEmail) codes.add(normalizedEmail);
        if (normalizedName) codes.add(normalizedName);
        return { emp: e, codes: Array.from(codes) };
      });
      const codes = Array.from(new Set(candidateMap.flatMap((c: any) => c.codes)));
      console.log(`[EXTERNAL-DATA] Searching for codes: ${JSON.stringify(codes)}`);

      const tsRes = await timesheetClient.query(
        `SELECT employee_code, ARRAY_AGG(DISTINCT CAST(date as date)) as worked_dates 
         FROM time_entries 
         WHERE UPPER(employee_code) = ANY($1) AND EXTRACT(MONTH FROM CAST(date as date)) = $2 AND EXTRACT(YEAR FROM CAST(date as date)) = $3
           AND LOWER(status) NOT IN ('draft', 'rejected')
         GROUP BY employee_code`,
        [codes, month, year]
      );

      console.log(`[EXTERNAL-DATA] Found ${tsRes.rows.length} matches from timesheet DB`);

      const calendarDays = new Date(year, month, 0).getDate();
      for (const row of tsRes.rows) {
        const rowCode = (row.employee_code || '').toUpperCase();
        const empMatch = candidateMap.find((entry: any) => entry.codes.includes(rowCode));
        const emp = empMatch?.emp;

        if (emp) {
          const workedDates = (row.worked_dates || []).map((d: Date | string) => {
            const dt = new Date(d);
            return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
          });
          const workedDatesSet = new Set(workedDates);

          // Determine which holidays apply to this employee based on their department
          const empDept = (emp.department || '').toLowerCase().trim();
          const empHolidays = allHolidays
            .filter(h => !h.applicable_departments || h.applicable_departments.length === 0 || h.applicable_departments.map(d => d.toLowerCase().trim()).includes(empDept))
            .map(h => h.date);
          const empHolidaySet = new Set(empHolidays);

          let rawMissingDates: string[] = [];
          for (let d = 1; d <= calendarDays; d++) {
            const dt = new Date(year, month - 1, d);
            const dstr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            if (dt.getDay() === 0) continue; // Skip Sunday
            if (empHolidaySet.has(dstr)) continue; // Skip applicable holidays
            if (!workedDatesSet.has(dstr)) {
              rawMissingDates.push(dstr);
            }
          }

          // Compute excluded dates: missing TS dates that fall on approved leave dates (no deduction)
          const empLeaves = leaveMap[emp.id];
          const leaveDateSet = new Set(empLeaves?.leave_dates || []);
          const excludedDates = rawMissingDates.filter(d => leaveDateSet.has(d));
          const actualMissingDates = rawMissingDates.filter(d => !leaveDateSet.has(d));

          const missing = actualMissingDates.length;

          console.log(`[EXTERNAL-DATA] ✅ MATCHED code ${row.employee_code} to employee ${emp.name} (${emp.id})`);
          console.log(`[EXTERNAL-DATA] Raw missing: ${rawMissingDates.length}, Excluded (on leave): ${excludedDates.length}, Final: ${missing}`);

          timesheetMap[emp.id] = {
            employee_id: emp.id,
            missing_days: missing,
            missing_dates: actualMissingDates,
            excluded_dates: excludedDates,
            holiday_dates: empHolidays,
            submitted_at: new Date().toISOString()
          };
        } else {
          console.log(`[EXTERNAL-DATA] ❌ Could not find employee for code ${row.employee_code} in fetched empData`);
        }
      }


    } else {
      console.warn('[EXTERNAL-DATA] Timesheet database URL not configured. Skipping external timesheet lookup.');
    }

    res.json({
      leaves: Object.values(leaveMap),
      timesheets: Object.values(timesheetMap),
      holidays: globalHolidays,
      holidayCount: holidayCount
    });

  } catch (error) {
    console.error('Error fetching external payroll data:', error);
    res.status(500).json({ error: 'Failed to fetch external payroll data' });
  } finally {
    if (lmsClient) lmsClient.release();
    if (timesheetClient) timesheetClient.release();
  }
});

router.get('/attendance', async (req, res) => {
  const apiUrl = process.env.ILOCK_API_URL || 'http://127.0.0.1:8001/iclock/api/transactions/';
  const limit = Number(req.query.limit || '200');

  try {
    const token = await getIclockToken();
    const url = new URL(apiUrl);
    if (limit > 0) url.searchParams.set('limit', String(limit));

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Token ${token}`,
      },
    });

    if (!response.ok) {
      const body = await response.text();
      return res.status(response.status).json({ error: `Attendance fetch failed: ${body}` });
    }

    const data = await response.json();
    if (Array.isArray(data)) {
      return res.json(data);
    }

    if (Array.isArray(data.results)) {
      return res.json(data.results);
    }

    return res.json(data);
  } catch (error) {
    console.error('Error fetching attendance from biometric API:', error);
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to fetch attendance logs' });
  }
});

router.post('/attendance/sync', async (req, res) => {
  const apiUrl = process.env.ILOCK_API_URL || 'http://127.0.0.1:8001/iclock/api/transactions/';
  const limit = Number(req.query.limit || '1000');

  let client;
  try {
    const token = await getIclockToken();
    const url = new URL(apiUrl);
    if (limit > 0) url.searchParams.set('limit', String(limit));

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Token ${token}`,
      },
    });

    if (!response.ok) {
      const body = await response.text();
      return res.status(response.status).json({ error: `Attendance fetch failed: ${body}` });
    }

    const data = await response.json();
    let records = [];
    if (Array.isArray(data)) {
      records = data;
    } else if (Array.isArray(data.results)) {
      records = data.results;
    } else {
      records = [data];
    }

    client = await payrollPool.connect();
    let newCount = 0;

    for (const record of records) {
      const emp_code = record.emp_code;
      const punch_time = record.punch_time;
      const punch_state = record.punch_state;
      const terminal = record.terminal_sn || record.terminal;

      if (!emp_code || !punch_time) continue;

      // Check if it already exists to prevent duplicates
      const exists = await client.query(
        'SELECT id FROM attendance_logs WHERE emp_code = $1 AND punch_time = $2',
        [emp_code, punch_time]
      );

      if (exists.rows.length === 0) {
        await client.query(
          `INSERT INTO attendance_logs (emp_code, punch_time, punch_state, terminal, received_at)
           VALUES ($1, $2, $3, $4, NOW())`,
          [emp_code, punch_time, punch_state || null, terminal || null]
        );
        newCount++;
      }
    }

    return res.json({ success: true, message: `Synced ${newCount} new records.`, count: newCount });
  } catch (error) {
    console.error('Error syncing attendance from biometric API:', error);
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to sync attendance logs' });
  } finally {
    if (client) client.release();
  }
});

// POST endpoint to receive attendance data from Easy Time Pro (push model)
router.post('/attendance', async (req, res) => {
  const { emp_code, punch_time, punch_state, terminal } = req.body;

  if (!emp_code || !punch_time) {
    return res.status(400).json({ error: 'emp_code and punch_time are required' });
  }

  let client;
  try {
    client = await payrollPool.connect();

    // Insert raw attendance log
    const insertRes = await client.query(
      `INSERT INTO attendance_logs (emp_code, punch_time, punch_state, terminal, received_at)
       VALUES ($1, $2, $3, $4, NOW())
       RETURNING *`,
      [emp_code, punch_time, punch_state || null, terminal || null]
    );

    const log = insertRes.rows[0];

    // Log the action
    await client.query(
      `INSERT INTO audit_logs (action, entity, entity_id, details, user_email) VALUES ($1,$2,$3,$4,$5)`,
      ['ATTENDANCE_PUNCH', 'attendance_logs', log.id, JSON.stringify({ emp_code, punch_state }), 'biometric_api']
    );

    res.status(201).json({ success: true, id: log.id, message: `Attendance recorded for ${emp_code}` });
  } catch (error) {
    console.error('Error recording attendance:', error);
    res.status(500).json({ error: 'Failed to record attendance' });
  } finally {
    if (client) client.release();
  }
});

// GET attendance logs from database (what the Attendance page uses)
router.get('/attendance/logs', async (req, res) => {
  let client;
  try {
    client = await payrollPool.connect();

    const limit = Number(req.query.limit || '200');
    const result = await client.query(
      `SELECT * FROM attendance_logs ORDER BY punch_time DESC LIMIT $1`,
      [limit]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching attendance logs:', error);
    res.status(500).json({ error: 'Failed to fetch attendance logs' });
  } finally {
    if (client) client.release();
  }
});

router.get('/payroll-items/analysis/:payrollId', async (req, res) => {
  const { payrollId } = req.params;

  let payrollClient, lmsClient, timesheetClient;

  try {
    payrollClient = await payrollPool.connect();
    lmsClient = lmsPool ? await lmsPool.connect() : null;
    timesheetClient = timesheetPool ? await timesheetPool.connect() : null;

    const payrollResult = await payrollClient.query('SELECT month, year FROM payrolls WHERE id=$1', [payrollId]);
    const payroll = payrollResult.rows[0];
    if (!payroll) {
      return res.status(404).json({ error: 'Payroll not found' });
    }

    const settingsResult = await payrollClient.query('SELECT value FROM settings WHERE key = \'working_days\'');
    const workingDays = parseInt(settingsResult.rows[0]?.value || '26');

    // Fetch holidays for the month to accurately compute missing days
    const holidayRes = await payrollClient.query(
      `SELECT date FROM holidays WHERE EXTRACT(MONTH FROM date) = $1 AND EXTRACT(YEAR FROM date) = $2`,
      [payroll.month, payroll.year]
    );
    const holidayCount = holidayRes.rows.length;
    // Helper: convert DB date/timestamp to local YYYY-MM-DD string without UTC timezone shift
    const toLocalDateStr = (d: Date | string): string => {
      const dt = new Date(d);
      return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    };
    const holidaySet = new Set(holidayRes.rows.map((r: any) => toLocalDateStr(r.date)));
    const holidayDatesAll = Array.from(holidaySet) as string[];

    const itemsResult = await payrollClient.query(
      `SELECT pi.*, e.id AS employee_id, e.name AS employee_name, e.email AS employee_email, e.designation AS employee_designation, e.department AS employee_department, e.bank_account AS employee_bank_account, e.pf_number AS employee_pf_number, e.uan_number AS employee_uan_number
       , e.employee_code AS employee_code
       FROM payroll_items pi
       JOIN employees e ON e.id = pi.employee_id
       WHERE pi.payroll_id = $1`,
      [payrollId]
    );

    console.log(`Analyzing payroll ${payrollId}: Found ${itemsResult.rows.length} items`);

    interface PayrollItemAnalysisRow {
      employee_id: string;
      employee_name: string;
      employee_email: string;
      employee_designation: string;
      employee_department: string;
      employee_bank_account: string;
      employee_pf_number: string;
      employee_uan_number: string;
      unpaid_leaves: number;
      missing_timesheets: number;
      holiday_count: number;
      [key: string]: unknown;
    }

    const enriched = [];
    for (const item of itemsResult.rows as (PayrollItemAnalysisRow & { monthly_salary: number })[]) {
      const monthlySalary = item.monthly_salary || 0;
      let leaveData: { unpaid_leaves?: number; leave_type?: string; leave_dates?: string[]; od_dates?: string[]; permission_hours?: number } | null = null;
      let tsData: { missing_days?: number; submitted_at?: string | null; missing_dates?: string[]; excluded_dates?: string[] } | null = null;

      // Use stored excluded/holiday dates if already saved (for current payrolls)
      const storedExcludedDates: string[] = (item.timesheet_excluded_dates as any) || [];
      const storedHolidayDates: string[] = (item.holiday_dates as any) || [];

      if (lmsClient) {
        try {
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
          const empCode = (item as any).employee_code || '';
          console.log(`[ANALYSIS] LMS query for ${item.employee_name}, code: ${empCode}`);
          const leaveRes = await lmsClient.query(leaveQuery, [payroll.month, payroll.year, item.employee_name, empCode]);
          if (leaveRes.rows.length > 0) {
            const allLeaveDates: string[] = [];
            const odDates: string[] = [];
            let unpaidCount = 0;
            let totalCount = 0;
            const leaveTypeSummary: string[] = [];

            for (const row of leaveRes.rows) {
              const d = toLocalDateStr(row.leave_date);
              const dayValue = row.leave_duration_type === 'Half Day' ? 0.5 : 1.0;
              allLeaveDates.push(d);
              totalCount += dayValue;
              leaveTypeSummary.push(row.leave_type);
              if (row.leave_type === 'OD') {
                odDates.push(d);
              } else {
                unpaidCount += dayValue;
              }
            }

            const uniqueAllLeaveDates = [...new Set(allLeaveDates)];
            const primaryLeaveType = leaveTypeSummary.find(t => t !== 'OD') || leaveTypeSummary[0] || 'Leave';
            console.log(`[ANALYSIS] LMS Match for ${item.employee_name}: ${totalCount} total, ${unpaidCount} unpaid (excl OD), ${odDates.length} OD dates`);
            leaveData = {
              unpaid_leaves: unpaidCount,
              total_leaves: totalCount,
              leave_type: primaryLeaveType,
              leave_dates: uniqueAllLeaveDates,
              od_dates: odDates,
              permission_hours: 0,
            } as any;
          }

          // Fetch permissions for this employee
          const permQuery = `
            SELECT SUM(total_hours) as total
            FROM permissions p
            LEFT JOIN employees e ON e.employee_code = p.user_id
            WHERE LOWER(p.status) = 'approved'
              AND EXTRACT(MONTH FROM p.permission_date) = $1
              AND EXTRACT(YEAR FROM p.permission_date) = $2
              AND (
                LOWER(TRIM(p.user_id)) = LOWER(TRIM($4))
                OR LOWER(TRIM(e.name)) = LOWER(TRIM($3))
                OR (e.name ILIKE $3 || '%')
                OR ($3 ILIKE e.name || '%')
              )
          `;
          const permRes = await lmsClient.query(permQuery, [payroll.month, payroll.year, item.employee_name, (item as any).employee_code || '']);
          if (permRes.rows.length > 0 && permRes.rows[0].total) {
            const permHours = parseFloat(permRes.rows[0].total);
            console.log(`[ANALYSIS] ✅ ${item.employee_name} has ${permHours} permission hours.`);
            if (!leaveData) leaveData = { unpaid_leaves: 0, permission_hours: permHours } as any;
            else (leaveData as any).permission_hours = permHours;
          }

        } catch (error) {
          console.error('LMS query failed for employee', item.employee_id, error);
        }
      }

      const calendarDays = new Date(payroll.year, payroll.month, 0).getDate();
      if (timesheetClient) {
        try {
          // Build an employee-code map from TimeStrap so email/name resolution is robust.
          const tsCodeMap = new Map<string, string>();
          const tsNameMap = new Map<string, string>();
          const tsEmpRes = await timesheetClient.query('SELECT name, email, employee_code FROM employees');
          tsEmpRes.rows.forEach((r: any) => {
            if (r.employee_code) {
              const code = r.employee_code.toUpperCase();
              if (r.email) tsCodeMap.set(r.email.toLowerCase(), code);
              if (r.name) tsNameMap.set(r.name.toLowerCase().trim(), code);
            }
          });

          const emailKey = (item.employee_email || '').toLowerCase();
          const nameKey = (item.employee_name || '').toLowerCase().trim();
          const explicitCode = (item as any).employee_code || null;
          const resolvedTsCode = tsCodeMap.get(emailKey) || tsNameMap.get(nameKey) || null;

          const candidateCodes = new Set<string>();
          if (explicitCode) candidateCodes.add(explicitCode.toUpperCase());
          if (resolvedTsCode) candidateCodes.add(resolvedTsCode.toUpperCase());
          if (item.employee_email) candidateCodes.add(item.employee_email.toUpperCase());
          if (item.employee_name) candidateCodes.add(item.employee_name.toUpperCase().trim());

          const lookupCodes = Array.from(candidateCodes).filter(Boolean);
          console.log(`[ANALYSIS] Fetching TS for ${item.employee_name} using codes ${JSON.stringify(lookupCodes)} for ${payroll.month}/${payroll.year}`);

          const missingDates: string[] = [];

          if (lookupCodes.length === 0) {
            console.warn(`[ANALYSIS] No TS lookup codes found for ${item.employee_name}; using stored DB values.`);
            // No code at all — cannot look up → fall back to stored DB values unchanged
            tsData = null;
          } else {
            const tsRes = await timesheetClient.query(
              `SELECT DISTINCT CAST(date AS date) AS d
               FROM time_entries
               WHERE UPPER(employee_code) = ANY($1) AND EXTRACT(MONTH FROM CAST(date as date)) = $2 AND EXTRACT(YEAR FROM CAST(date as date)) = $3
                 AND LOWER(status) NOT IN ('draft', 'rejected')`,
              [lookupCodes, payroll.month, payroll.year]
            );

            if (tsRes.rows.length > 0) {
              // Employee has submitted some timesheet entries — compute missing days normally
              const workedDatesSet = new Set(tsRes.rows.map((r: any) => toLocalDateStr(r.d)));
              for (let d = 1; d <= calendarDays; d++) {
                const dt = new Date(payroll.year, payroll.month - 1, d);
                const dstr = `${payroll.year}-${String(payroll.month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                if (dt.getDay() === 0) continue;
                if (holidaySet.has(dstr)) continue;
                if (!workedDatesSet.has(dstr)) missingDates.push(dstr);
              }
              console.log(`[ANALYSIS] ✅ Found ${tsRes.rows.length} worked days for ${item.employee_name}, missing ${missingDates.length}`);
              tsData = {
                missing_days: missingDates.length,
                missing_dates: missingDates,
                submitted_at: new Date().toISOString()
              };
            } else {
              // Employee code is known but ZERO entries in Timestrap = timesheet NOT submitted
              // Count ALL working days (excl. Sundays and holidays) as missing
              console.log(`[ANALYSIS] ⚠️ ${item.employee_name} (${JSON.stringify(lookupCodes)}) has NO timesheet entries — all working days counted as missing`);
              for (let d = 1; d <= calendarDays; d++) {
                const dt = new Date(payroll.year, payroll.month - 1, d);
                const dstr = `${payroll.year}-${String(payroll.month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                if (dt.getDay() === 0) continue;
                if (holidaySet.has(dstr)) continue;
                missingDates.push(dstr);
              }
              tsData = {
                missing_days: missingDates.length,
                missing_dates: missingDates,
                submitted_at: null  // null = not submitted
              };
            }
          }
        } catch (error) {
          console.error('[ANALYSIS] Timesheet query failed for employee', item.employee_id, error);
        }
      }

      const leaveDatesArray = leaveData?.leave_dates ?? [];
      const leaveDateSet = new Set(leaveDatesArray);

      // --- CASE 1: We have live timesheet data from Timestrap ---
      // Compute missing dates and exclude any that are covered by approved leave
      // --- CASE 2: No timesheet data (employee not in Timestrap or no entries found) ---
      // Fall back to stored DB values - do NOT touch their deductions

      let actualMissingDates: string[];
      let actualMissingTsDays: number;
      let finalExcludedDates: string[];
      let timesheetDeduction: number;

      if (tsData !== null && tsData.missing_dates) {
        // We have live TS data — compute overlap with leave dates
        const rawMissingDates = tsData.missing_dates;
        const excludedByLeave = rawMissingDates.filter((d: string) => leaveDateSet.has(d));
        actualMissingDates = rawMissingDates.filter((d: string) => !leaveDateSet.has(d));
        actualMissingTsDays = actualMissingDates.length;
        finalExcludedDates = excludedByLeave;

        timesheetDeduction = Math.round(
          ((monthlySalary || 0) / (calendarDays || 30)) * actualMissingTsDays * 100
        ) / 100;

        console.log(`[ANALYSIS] ${item.employee_name}: leave_dates=${leaveDatesArray.length}, raw_missing=${rawMissingDates.length}, excluded_by_leave=${excludedByLeave.length}, final_deducted=${actualMissingTsDays}`);
      } else {
        // No live TS data — use stored DB values unchanged
        actualMissingTsDays = Number(item.missing_timesheets) || 0;
        actualMissingDates = storedExcludedDates.length > 0 ? [] : []; // No live data to filter
        finalExcludedDates = storedExcludedDates;
        timesheetDeduction = Number(item.timesheet_deduction) || 0;

        console.log(`[ANALYSIS] ${item.employee_name}: No live TS data — using stored: ${actualMissingTsDays} missing days, deduction=${timesheetDeduction}`);
      }

      const finalHolidayDates = holidayDatesAll;

      const leaveMatchedTsDays = finalExcludedDates.length;

      const leaveDeduction = Number(item.leave_deduction) || 0;
      const pfDeduction = Number(item.pf_deduction) || 0;
      const esiDeduction = Number(item.esi_deduction) || 0;
      const taxDeduction = Number(item.tax_deduction) || 0;
      const loanDeduction = Number(item.loan_deduction) || 0;
      const advanceDeduction = Number(item.advance_deduction) || 0;
      const bonus = Number(item.bonus) || 0;

      const permissionHours = leaveData?.permission_hours ?? Number(item.permission_hours) ?? 0;
      let permissionDeduction = Number(item.permission_deduction) || 0;

      // If we are actively analyzing live data and have LMS permissions, recalculate
      if (leaveData !== null && permissionHours > 3) {
        const excessHours = permissionHours - 3;
        const perHourSalary = ((monthlySalary || 0) / (calendarDays || 30)) / 8;
        permissionDeduction = Math.round(excessHours * perHourSalary * 100) / 100;
      }

      // --- Missing Punch Detection ---
      // Check attendance_logs for days with NO punch at all (no punch in, no punch out)
      // Cross-reference with LMS approved leaves: if leave is approved for that day, no deduction
      const empCode = (item as any).employee_code || '';
      let missingPunchDays = 0;
      let missingPunchDeduction = 0;
      const missingPunchDates: string[] = [];
      const coveredByLeaveDates: string[] = []; // Missing punch days covered by approved leave

      if (empCode) {
        try {
          // Get all dates this employee has attendance records for
          const attRes = await payrollClient.query(
            `SELECT DISTINCT TO_CHAR(punch_time AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') as att_date
             FROM attendance_logs
             WHERE UPPER(emp_code) = UPPER($1)
               AND EXTRACT(MONTH FROM punch_time AT TIME ZONE 'Asia/Kolkata') = $2
               AND EXTRACT(YEAR FROM punch_time AT TIME ZONE 'Asia/Kolkata') = $3`,
            [empCode, payroll.month, payroll.year]
          );
          const punchedDatesSet = new Set(attRes.rows.map((r: any) => r.att_date));

          // Find working days with NO punch at all
          for (let d = 1; d <= calendarDays; d++) {
            const dt = new Date(payroll.year, payroll.month - 1, d);
            const dstr = `${payroll.year}-${String(payroll.month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            if (dt.getDay() === 0) continue; // Skip Sunday
            if (holidaySet.has(dstr)) continue; // Skip holidays
            if (punchedDatesSet.has(dstr)) continue; // Has punch, skip

            // This day has NO punch at all - check if covered by LMS approved leave
            if (leaveDateSet.has(dstr)) {
              // Covered by approved leave - no deduction
              coveredByLeaveDates.push(dstr);
            } else {
              // No punch AND no leave - this is a deductible missing punch day
              missingPunchDates.push(dstr);
            }
          }

          missingPunchDays = missingPunchDates.length;
          const perDaySalary = (monthlySalary || 0) / (calendarDays || 30);
          missingPunchDeduction = Math.round(perDaySalary * missingPunchDays * 100) / 100;

          if (missingPunchDays > 0) {
            console.log(`[ANALYSIS] ⚠️ ${item.employee_name}: ${missingPunchDays} days with missing punches (no LMS leave). Deduction: ${missingPunchDeduction}`);
          }
          if (coveredByLeaveDates.length > 0) {
            console.log(`[ANALYSIS] ✅ ${item.employee_name}: ${coveredByLeaveDates.length} missing punch days covered by approved leave — no deduction`);
          }
        } catch (attErr) {
          console.error(`[ANALYSIS] Attendance query failed for ${item.employee_name}:`, attErr);
        }
      }

      const sundayEarnings = Math.round(((monthlySalary || 0) / (calendarDays || 30)) * (Number(item.sunday_work_days) || 0) * 100) / 100;
      const netSalary = Math.max(
        0,
        Math.round((monthlySalary - leaveDeduction - timesheetDeduction - missingPunchDeduction - permissionDeduction - pfDeduction - esiDeduction - taxDeduction - loanDeduction - advanceDeduction + bonus + sundayEarnings) * 100) / 100
      );

      enriched.push({
        ...item,
        employee: {
          id: item.employee_id,
          name: item.employee_name,
          email: item.employee_email,
          designation: item.employee_designation,
          department: item.employee_department,
          bank_account: item.employee_bank_account,
          pf_number: item.employee_pf_number,
          uan_number: item.employee_uan_number,
        },
        unpaid_leaves: leaveData?.unpaid_leaves ?? item.unpaid_leaves,
        leave_source: leaveData ? `LMS (${(leaveData as any).leave_type})` : 'No LMS leave record',
        leave_type: (leaveData as any)?.leave_type ?? null,
        od_dates: (leaveData as any)?.od_dates ?? [],
        leave_matched_ts_dates: leaveData?.leave_dates ?? [],
        missing_timesheets: actualMissingTsDays,
        missing_dates: actualMissingDates,
        leave_matched_ts_days: leaveMatchedTsDays,
        timesheet_deduction: timesheetDeduction,
        missing_punches: missingPunchDays,
        missing_punch_deduction: missingPunchDeduction,
        missing_punch_dates: missingPunchDates,
        covered_by_leave_dates: coveredByLeaveDates,
        permission_hours: permissionHours,
        permission_deduction: permissionDeduction,
        net_salary: netSalary,
        timesheet_status: tsData?.submitted_at ? 'Submitted' : 'Not submitted',
        timesheet_submitted_at: tsData?.submitted_at || null,
        timesheet_excluded_dates: finalExcludedDates,
        holiday_dates: finalHolidayDates,
        leave_dates: leaveDatesArray,
      });
    }

    console.log(`Sending enriched analysis for ${enriched.length} items...`);
    res.json(enriched);
  } catch (error) {
    console.error('Error fetching payroll item analysis:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to fetch payroll analysis' });
  } finally {
    if (payrollClient) payrollClient.release();
    if (lmsClient) lmsClient.release();
    if (timesheetClient) timesheetClient.release();
  }
});

router.patch('/payroll-items/:id', async (req, res) => {
  const { id } = req.params;
  const {
    sunday_work_days,
    bonus,
    unpaid_leaves,
    leave_deduction,
    missing_timesheets,
    timesheet_deduction,
    missing_punches,
    missing_punch_deduction,
    timesheet_excluded_dates,
    holiday_dates,
    advance_deduction,
    permission_hours,
    permission_deduction
  } = req.body;

  let client;
  try {
    client = await payrollPool.connect();

    // Fetch the payroll item AND the payroll month/year to compute calendar days
    const currentRes = await client.query(
      `SELECT pi.*, p.month, p.year 
       FROM payroll_items pi 
       JOIN payrolls p ON pi.payroll_id = p.id 
       WHERE pi.id = $1`,
      [id]
    );
    const item = currentRes.rows[0];
    if (!item) return res.status(404).json({ error: 'Item not found' });

    // Take new advance from req.body if provided (for refresh), otherwise fallback to stored
    const storedAdvance = advance_deduction !== undefined ? parseFloat(advance_deduction) : parseFloat(item.advance_deduction || 0);
    const newSundayWork = sunday_work_days !== undefined ? parseFloat(sunday_work_days) : parseFloat(item.sunday_work_days || 0);
    const newBonus = bonus !== undefined ? parseFloat(bonus) : parseFloat(item.bonus || 0);

    const newUnpaidLeaves = unpaid_leaves !== undefined ? parseFloat(unpaid_leaves) : parseFloat(item.unpaid_leaves || 0);
    const newMissingTimesheets = missing_timesheets !== undefined ? parseInt(missing_timesheets) : parseInt(item.missing_timesheets || 0);
    const newMissingPunches = missing_punches !== undefined ? parseFloat(missing_punches) : parseFloat(item.missing_punches || 0);

    // Support JSON arrays for dates
    const newExcludedDates = timesheet_excluded_dates !== undefined ? JSON.stringify(timesheet_excluded_dates) : item.timesheet_excluded_dates;
    const newHolidayDates = holiday_dates !== undefined ? JSON.stringify(holiday_dates) : item.holiday_dates;

    const monthlySalary = parseFloat(item.monthly_salary);

    // Use actual calendar days of the payroll month for per-day rate (same as generation)
    const calendarDays = new Date(parseInt(item.year), parseInt(item.month), 0).getDate();
    const dayRate = monthlySalary / calendarDays;

    const finalLeaveDeduction = leave_deduction !== undefined ? parseFloat(leave_deduction) : parseFloat(item.leave_deduction);
    const tsDeduction = timesheet_deduction !== undefined ? parseFloat(timesheet_deduction) : parseFloat(item.timesheet_deduction);
    const mpDeduction = missing_punch_deduction !== undefined ? parseFloat(missing_punch_deduction) : parseFloat(item.missing_punch_deduction || 0);
    const pfDeduction = parseFloat(item.pf_deduction);
    const esiDeduction = parseFloat(item.esi_deduction);
    const taxDeduction = parseFloat(item.tax_deduction);
    const loanDeduction = parseFloat(item.loan_deduction);

    const sundayEarnings = Math.round(dayRate * newSundayWork * 100) / 100;

    const newPermissionHours = permission_hours !== undefined ? parseFloat(permission_hours) : parseFloat(item.permission_hours || 0);
    const newPermissionDeduction = permission_deduction !== undefined ? parseFloat(permission_deduction) : parseFloat(item.permission_deduction || 0);

    const totalDeductions = finalLeaveDeduction + tsDeduction + mpDeduction + pfDeduction + esiDeduction + taxDeduction + loanDeduction + storedAdvance + newPermissionDeduction;
    const netSalary = Math.max(0, Math.round((monthlySalary - totalDeductions + newBonus + sundayEarnings) * 100) / 100);

    const updateRes = await client.query(
      `UPDATE payroll_items SET 
        sunday_work_days = $1, 
        bonus = $2, 
        net_salary = $3,
        unpaid_leaves = $4,
        leave_deduction = $5,
        missing_timesheets = $6,
        timesheet_deduction = $7,
        timesheet_excluded_dates = $8,
        holiday_dates = $9,
        advance_deduction = $10,
        permission_hours = $11,
        permission_deduction = $12,
        missing_punches = $13,
        missing_punch_deduction = $14
       WHERE id = $15 RETURNING *`,
      [
        newSundayWork,
        newBonus,
        netSalary,
        newUnpaidLeaves,
        finalLeaveDeduction,
        newMissingTimesheets,
        tsDeduction,
        newExcludedDates,
        newHolidayDates,
        storedAdvance,
        newPermissionHours,
        newPermissionDeduction,
        newMissingPunches,
        mpDeduction,
        id
      ]
    );

    await client.query(
      `UPDATE payrolls 
       SET total_amount = (SELECT COALESCE(SUM(net_salary), 0) FROM payroll_items WHERE payroll_id = $1)
       WHERE id = $1`,
      [item.payroll_id]
    );

    res.json(updateRes.rows[0]);
  } catch (err) {
    console.error('Error updating payroll item:', err);
    res.status(500).json({ error: 'Failed to update item' });
  } finally {
    if (client) client.release();
  }
});

router.get('/settings', async (req, res) => {
  let client;
  try {
    client = await payrollPool.connect();
    const result = await client.query('SELECT * FROM system_settings');
    const settings = result.rows.reduce((acc: any, row: any) => ({ ...acc, [row.key]: row.value }), {});
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch settings' });
  } finally {
    if (client) client.release();
  }
});

router.post('/settings', async (req, res) => {
  const { biometric_ip, biometric_port } = req.body;
  let client;
  try {
    client = await payrollPool.connect();
    if (biometric_ip) {
      await client.query('INSERT INTO system_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2', ['biometric_ip', biometric_ip]);
    }
    if (biometric_port) {
      await client.query('INSERT INTO system_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2', ['biometric_port', biometric_port.toString()]);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update settings' });
  } finally {
    if (client) client.release();
  }
});

router.post('/attendance/sync-direct', async (req, res) => {
  let client;
  let deviceIp = process.env.BIOMETRIC_DEVICE_IP || '192.168.1.201';
  let devicePort = parseInt(process.env.BIOMETRIC_DEVICE_PORT || '4370');

  try {
    client = await payrollPool.connect();
    const settingsRes = await client.query('SELECT * FROM system_settings');
    const settings = settingsRes.rows.reduce((acc: any, row: any) => ({ ...acc, [row.key]: row.value }), {});

    if (settings.biometric_ip) deviceIp = settings.biometric_ip;
    if (settings.biometric_port) devicePort = parseInt(settings.biometric_port);

    console.log(`Connecting to biometric machine at ${deviceIp}:${devicePort}...`);
    let machine = new ZKLib(deviceIp, devicePort, 10000, 4000);
    await machine.createSocket();

    const attendances = await machine.getAttendances();
    console.log(`Fetched ${attendances.data.length} attendance records from machine.`);

    client = await payrollPool.connect();
    let newCount = 0;

    for (const record of attendances.data) {
      const emp_code = record.deviceUserId;
      const punch_time = record.recordTime;

      if (!emp_code || !punch_time) continue;

      const exists = await client.query(
        'SELECT id FROM attendance_logs WHERE emp_code = $1 AND punch_time = $2',
        [emp_code, punch_time]
      );

      if (exists.rows.length === 0) {
        await client.query(
          `INSERT INTO attendance_logs (emp_code, punch_time, received_at)
           VALUES ($1, $2, NOW())`,
          [emp_code, punch_time]
        );
        newCount++;
      }
    }

    await machine.disconnect();
    return res.json({ success: true, message: `Successfully synced ${newCount} new records directly from machine.`, count: newCount });
  } catch (error) {
    console.error('Error syncing directly from biometric machine:', error);
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to sync directly from machine. Make sure your laptop is on the same office network (WiFi) as the machine.' });
  } finally {
    if (client) client.release();
  }
});

router.get('/daily-analysis', async (req, res) => {
  const dateStr = req.query.date as string;
  if (!dateStr) return res.status(400).json({ error: 'Date is required' });

  let pClient, lmsClient, timesheetClient;
  try {
    pClient = await payrollPool.connect();
    const empRes = await pClient.query("SELECT id, name, email, department, employee_code FROM employees WHERE status = 'active'");
    const employees = empRes.rows;

    const attRes = await pClient.query(
      `SELECT emp_code, MIN(punch_time) as first_punch, MAX(punch_time) as last_punch
       FROM attendance_logs 
       WHERE CAST(punch_time AS date) = $1
       GROUP BY emp_code`,
      [dateStr]
    );
    const attendanceMap = new Map(attRes.rows.map((r: any) => [r.emp_code?.toUpperCase(), r]));

    const leaveMap = new Map();
    if (lmsPool) {
      lmsClient = await lmsPool.connect();
      const leaveRes = await lmsClient.query(
        `SELECT user_id, leave_type, status
         FROM leaves 
         WHERE status = 'Approved' 
           AND CAST($1 AS date) >= CAST(start_date AS date) 
           AND CAST($1 AS date) <= CAST(end_date AS date)`,
        [dateStr]
      );
      leaveRes.rows.forEach((r: any) => {
        if (r.user_id) leaveMap.set(r.user_id.toUpperCase(), r);
      });
    }

    const timesheetMap = new Map();
    const tsCodeMap = new Map();
    const tsNameMap = new Map();
    if (timesheetPool) {
      timesheetClient = await timesheetPool.connect();
      const allTsRes = await timesheetClient.query(
        `SELECT *
         FROM time_entries
         WHERE CAST(date AS date) = $1`,
        [dateStr]
      );
      allTsRes.rows.forEach((r: any) => {
        const code = (r.employee_code || '').toUpperCase();
        if (!code) return;
        const current = timesheetMap.get(code) || { minutes: 0, entries: [], manager_approved: true, admin_approved: true };

        // Use verified column names
        const isManager = r.manager_approved === true || r.manager_approved === 'true' || !!r.manager_approved_at;
        if (!isManager) current.manager_approved = false;

        const isAdmin = r.status === 'Approved' || !!r.approved_at || !!r.approved_by;
        if (!isAdmin) current.admin_approved = false;

        let m = 0;
        const th = r.total_hours || '';
        const matchHM = th.match(/(\d+)\s*h\s*(\d+)\s*m/i);
        const matchH = th.match(/(\d+)\s*h/i);
        const matchM = th.match(/(\d+)\s*m/i);
        if (matchHM) {
          m += parseInt(matchHM[1]) * 60 + parseInt(matchHM[2]);
        } else if (matchH) {
          m += parseInt(matchH[1]) * 60;
          if (matchM && !th.includes('h')) m += parseInt(matchM[1]);
        } else if (matchM) {
          m += parseInt(matchM[1]);
        }

        current.minutes += m;
        current.entries.push({
          task: r.task_description || r.task || r.description || '',
          project: r.project_name || r.project || 'General Task',
          hours: r.total_hours || r.hours || '',
          startTime: r.start_time || r.startTime || '—',
          endTime: r.end_time || r.endTime || '—',
          achievements: r.achievements || '',
          status: r.status || r.manager_status || 'Pending'
        });
        timesheetMap.set(code, current);
      });

      // Fetch employee mapping from TimeStrap to link via Email or Name
      const tsEmpRes = await timesheetClient.query('SELECT name, email, employee_code FROM employees');
      tsEmpRes.rows.forEach((r: any) => {
        if (r.employee_code) {
          const code = r.employee_code.toUpperCase();
          if (r.email) tsCodeMap.set(r.email.toLowerCase(), code);
          if (r.name) tsNameMap.set(r.name.toLowerCase().trim(), code);
        }
      });
    }

    const result = employees.map((emp: any) => {
      const emailKey = (emp.email || '').toLowerCase();
      const nameKey = (emp.name || '').toLowerCase().trim();

      // Priority: 1) employee_code field (manually set), 2) TimeStrap code map (by email/name), 3) email fallback
      let code: string;
      if (emp.employee_code) {
        code = emp.employee_code.toUpperCase();
      } else if (emp.name.toUpperCase().includes('REBECA')) {
        code = 'E0046';
      } else {
        code = tsCodeMap.get(emailKey) || tsNameMap.get(nameKey) || emailKey.toUpperCase();
      }

      const att = attendanceMap.get(code) as any;
      const leave = leaveMap.get(code) as any;
      const ts = timesheetMap.get(code) as any;

      const biometricMinutes = att ? Math.floor((new Date(att.last_punch).getTime() - new Date(att.first_punch).getTime()) / (1000 * 60)) : 0;

      let tsFormatted = null;
      if (ts) {
        const h = Math.floor(ts.minutes / 60);
        const rm = ts.minutes % 60;
        tsFormatted = `${h}h ${rm}m`;
      }

      return {
        id: emp.id,
        name: emp.name,
        department: emp.department,
        email: emp.email,
        attendance: att ? { first_punch: att.first_punch, last_punch: att.last_punch, minutes: biometricMinutes } : null,
        timesheet: ts ? { hours: tsFormatted, minutes: ts.minutes, entries: ts.entries, manager_approved: ts.manager_approved, admin_approved: ts.admin_approved } : null,
        leave: leave ? { type: leave.leave_type, status: leave.status } : null,
      };
    });

    res.json(result);
  } catch (err) {
    console.error('Daily analysis fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch analysis' });
  } finally {
    if (pClient) pClient.release();
    if (lmsClient) lmsClient.release();
    if (timesheetClient) timesheetClient.release();
  }
});

router.get('/advances', async (req, res) => {
  let client;
  try {
    client = await payrollPool.connect();
    const result = await client.query(`
      SELECT a.*, e.name as employee_name, e.department
      FROM advances a
      JOIN employees e ON a.employee_id = e.id
      ORDER BY a.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching advances:', err);
    res.status(500).json({ error: 'Failed to fetch advances' });
  } finally {
    if (client) client.release();
  }
});

router.post('/advances', async (req, res) => {
  const { employee_id, amount, date, reason, repayment_type, installment_amount, remarks } = req.body;
  let client;
  try {
    client = await payrollPool.connect();
    const result = await client.query(`
      INSERT INTO advances (employee_id, amount, date, reason, repayment_type, installment_amount, balance, remarks, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Active')
      RETURNING *
    `, [
      employee_id,
      parseFloat(amount.toString()) || 0,
      date,
      reason,
      repayment_type,
      parseFloat((installment_amount || '0').toString()) || 0,
      parseFloat(amount.toString()) || 0,
      remarks
    ]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating advance:', err);
    res.status(500).json({ error: 'Failed to create advance' });
  } finally {
    if (client) client.release();
  }
});

router.put('/advances/:id', async (req, res) => {
  const { id } = req.params;
  const { amount, date, reason, repayment_type, installment_amount, remarks } = req.body;
  let client;
  try {
    client = await payrollPool.connect();
    // Re-calculate balance if amount changes (simple calculation assuming no deductions have been made yet, or preserving recovered amount difference)
    const currentRes = await client.query('SELECT amount, balance FROM advances WHERE id = $1', [id]);
    if (currentRes.rows.length === 0) return res.status(404).json({ error: 'Advance not found' });
    const current = currentRes.rows[0];
    const recovered = Number(current.amount) - Number(current.balance);
    const newAmount = parseFloat(amount.toString()) || 0;
    const newBalance = Math.max(0, newAmount - recovered);

    const result = await client.query(`
      UPDATE advances
      SET amount = $1, date = $2, reason = $3, repayment_type = $4, installment_amount = $5, balance = $6, remarks = $7
      WHERE id = $8
      RETURNING *
    `, [
      newAmount,
      date,
      reason,
      repayment_type,
      parseFloat((installment_amount || '0').toString()) || 0,
      newBalance,
      remarks,
      id
    ]);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating advance:', err);
    res.status(500).json({ error: 'Failed to update advance' });
  } finally {
    if (client) client.release();
  }
});

router.delete('/advances/:id', async (req, res) => {
  const { id } = req.params;
  let client;
  try {
    client = await payrollPool.connect();
    await client.query('DELETE FROM advances WHERE id = $1', [id]);
    res.status(204).send();
  } catch (err) {
    console.error('Error deleting advance:', err);
    res.status(500).json({ error: 'Failed to delete advance' });
  } finally {
    if (client) client.release();
  }
});
// GET /api/employee-monthly-report?employeeId=X&month=M&year=Y
router.get('/employee-monthly-report', async (req, res) => {
  const { employeeId, month, year } = req.query;
  if (!employeeId || !month || !year) return res.status(400).json({ error: 'Missing parameters' });

  const startDate = new Date(Number(year), Number(month) - 1, 1, 0, 0, 0);
  const endDate = new Date(Number(year), Number(month), 0, 23, 59, 59);

  // Cap at today if it's the current month
  const today = new Date();
  const cappedEndDate = (Number(month) === today.getMonth() + 1 && Number(year) === today.getFullYear())
    ? new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59) : endDate;

  let pClient, lmsClient, timesheetClient;
  try {
    pClient = await payrollPool.connect();

    // Get employee details
    const empRes = await pClient.query("SELECT * FROM employees WHERE id = $1", [employeeId]);
    if (empRes.rows.length === 0) return res.status(404).json({ error: 'Employee not found' });
    const employee = empRes.rows[0];
    const code = (employee.employee_code || '').toUpperCase();
    const emailKey = (employee.email || '').toLowerCase();

    // Get attendance logs for the month
    const attRes = await pClient.query(
      `SELECT CAST(punch_time AS date) as date, MIN(punch_time) as first_punch, MAX(punch_time) as last_punch
       FROM attendance_logs 
       WHERE emp_code = $1 AND punch_time >= $2 AND punch_time <= $3
       GROUP BY CAST(punch_time AS date)
       ORDER BY date ASC`,
      [code, startDate.toISOString(), endDate.toISOString()]
    );
    const attendanceMap = new Map(attRes.rows.map((r: any) => [formatDate(r.date), r]));

    // Get leaves from LMS
    let leaveMap = new Map();
    if (lmsPool) {
      lmsClient = await lmsPool.connect();
      const leaveRes = await lmsClient.query(
        `SELECT start_date, end_date, leave_type, status
         FROM leaves 
         WHERE (user_id = $1 OR username = $2) AND status = 'Approved'
           AND start_date <= $3 AND end_date >= $4`,
        [code, employee.name, endDate.toISOString(), startDate.toISOString()]
      );

      // Expand date ranges into a map
      leaveRes.rows.forEach((l: any) => {
        let curr = new Date(l.start_date);
        const end = new Date(l.end_date);
        while (curr <= end) {
          leaveMap.set(formatDate(curr), l.leave_type);
          curr.setDate(curr.getDate() + 1);
        }
      });
    }

    // Get timesheets
    let tsMap = new Map();
    if (timesheetPool) {
      timesheetClient = await timesheetPool.connect();
      const candidateCodes = new Set<string>();
      if (code) candidateCodes.add(code);
      if (emailKey) candidateCodes.add(emailKey.toUpperCase());
      if (employee.name) candidateCodes.add(employee.name.toUpperCase().trim());
      const lookupCodes = Array.from(candidateCodes).filter(Boolean);
      const tsRes = await timesheetClient.query(
        `SELECT date, total_hours
         FROM time_entries
         WHERE UPPER(employee_code) = ANY($1) AND date >= $2 AND date <= $3`,
        [lookupCodes, startDate.toISOString(), endDate.toISOString()]
      );
      tsRes.rows.forEach((r: any) => {
        const dStr = formatDate(r.date);
        const val = r.total_hours || '';
        const hMatch = val.match(/(\d+)\s*h/i);
        const mMatch = val.match(/(\d+)\s*m/i);

        let h = hMatch ? parseInt(hMatch[1]) : 0;
        let m = mMatch ? parseInt(mMatch[1]) : 0;
        let totalMins = (h * 60) + m;

        // Sum up multiple entries for the same day
        const existingMins = tsMap.get(dStr) || 0;
        tsMap.set(dStr, existingMins + totalMins);
      });

      // Format the summed minutes back to Hh Mm string
      for (let [date, mins] of tsMap.entries()) {
        const h = Math.floor(mins / 60);
        const m = mins % 60;
        tsMap.set(date, `${h}h ${m}m`);
      }
    }

    // Build the day-by-day list
    const report = [];
    let curr = new Date(startDate);
    while (curr <= cappedEndDate) {
      const dStr = formatDate(curr);
      const att = attendanceMap.get(dStr) as any;
      const leave = leaveMap.get(dStr);
      const ts = tsMap.get(dStr);

      report.push({
        date: dStr,
        day: curr.toLocaleDateString('en-US', { weekday: 'short' }),
        attendance: att ? {
          in: formatTime(att.first_punch),
          out: formatTime(att.last_punch),
          duration: calculateDuration(att.first_punch, att.last_punch)
        } : null,
        leave: leave || null,
        timesheet: ts || null,
        isSunday: curr.getDay() === 0
      });
      curr.setDate(curr.getDate() + 1);
    }

    res.json({ employee, report });

  } catch (err) {
    console.error('Error generating employee report:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    if (pClient) pClient.release();
    if (lmsClient) lmsClient.release();
    if (timesheetClient) timesheetClient.release();
  }
});

function formatDate(date: any) {
  if (!date) return '';
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatTime(date: any) {
  if (!date) return '';
  return new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function calculateDuration(start: any, end: any) {
  if (!start || !end) return '0h 0m';
  const diff = new Date(end).getTime() - new Date(start).getTime();
  const mins = Math.floor(diff / (1000 * 60));
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

export { router as payrollRouter };