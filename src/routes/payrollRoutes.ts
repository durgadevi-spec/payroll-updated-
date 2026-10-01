import { Router } from 'express';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import ZKLib from 'node-zklib';
import { sendEmail } from './emailRoutes';
import { calculatePayroll } from '../lib/payrollCalculator';

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
    return connectionString.replace(/([?&])sslmode=(require|prefer|verify-ca)(&|$)/gi, (_match, sep, _mode, tail) => {
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

// Runs `mapper` over `items` with at most `limit` in flight at once, preserving input order
// in the returned array (regardless of which items finish first). Used instead of a plain
// `Promise.all(items.map(...))` for per-employee DB work — full unbounded concurrency was
// tried first, but for a payroll with many employees it opened one connection per employee
// per query *simultaneously* against the LMS/TimeStrap databases, which can exceed those
// databases' own connection ceilings (often lower than this app's local pool `max`) and
// cause OTHER requests to fail acquiring a connection at all. Capping concurrency keeps the
// speed benefit of not running everything fully serial, without the connection-storm risk.
async function mapWithConcurrency<T, R>(items: T[], limit: number, mapper: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex++;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

function createPool(connectionString: string) {
  const normalizedConnectionString = normalizeConnectionString(connectionString);
  return new Pool({
    connectionString: normalizedConnectionString,
    ssl: { rejectUnauthorized: false },
    max: 30,
    idleTimeoutMillis: 120000,     // 2 minutes — give idle connections more breathing room
    connectionTimeoutMillis: 30000, // 30 seconds — was 2s which killed complex queries
    query_timeout: 60000,           // 60 seconds max per query
  });
}

type PgPool = ReturnType<typeof createPool>;

async function safeConnectOptionalPool(pool: PgPool | null) {
  if (!pool) return null;

  try {
    return await pool.connect();
  } catch (error) {
    console.warn('[DB] Optional database unavailable; continuing without it:', error instanceof Error ? error.message : error);
    return null;
  }
}

export const payrollPool = createPool(payrollUrl);
const lmsPool = lmsUrl ? createPool(lmsUrl) : null;
const timesheetPool = timesheetUrl ? createPool(timesheetUrl) : null;

// ─── Timesheet Approval Requirement ───────────────────────────────────────────
// Admin setting (Settings → Payroll Rules → "Timesheet approval required", stored in the
// `settings` table under key `timesheet_approval_required`).
//   OFF (default) → a day counts as worked as soon as a timesheet is submitted (old behaviour).
//   ON            → a day counts as worked ONLY if that day's timesheet is approved by the
//                   manager OR the admin (either one is enough). Submitted-but-unapproved days
//                   are treated exactly like missing timesheet days (LOP) and are also reported
//                   separately as "not approved" so the UI can label them.
async function isTimesheetApprovalRequired(client: any): Promise<boolean> {
  try {
    const r = await client.query(`SELECT value FROM settings WHERE key = 'timesheet_approval_required'`);
    const v = String(r.rows[0]?.value ?? '').trim().toLowerCase();
    return v === 'true' || v === '1' || v === 'yes' || v === 'on';
  } catch (err: any) {
    console.warn('[TS-APPROVAL] Could not read timesheet_approval_required setting, defaulting to OFF:', err?.message);
    return false;
  }
}

// One time_entries row counts as "approved" when the manager OR the admin approved it.
// Same signals the Daily Analysis page already uses:
//   manager → manager_approved = true  OR manager_approved_at set
//   admin   → status = 'Approved'      OR approved_at / approved_by set
// Column reads go through to_jsonb() so this never errors if a column is absent in the
// Timestrap DB (a missing column simply reads as NULL).
const TS_ENTRY_APPROVED_SQL = `(
  LOWER(COALESCE(to_jsonb(te)->>'manager_approved', '')) IN ('true', 't', '1')
  OR NULLIF(to_jsonb(te)->>'manager_approved_at', '') IS NOT NULL
  OR LOWER(COALESCE(to_jsonb(te)->>'status', '')) = 'approved'
  OR NULLIF(to_jsonb(te)->>'approved_at', '') IS NOT NULL
  OR NULLIF(to_jsonb(te)->>'approved_by', '') IS NOT NULL
)`;

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

const router = Router();

// ─── Payroll Lock ─────────────────────────────────────────────────────────────
// A generated payroll can be LOCKED. Locking captures a snapshot of exactly what the
// analysis view shows at that moment; from then on the analysis endpoint serves that
// snapshot instead of recalculating live from LMS / timesheets / attendance /
// holidays / employee data, and every route that edits payroll items refuses to run.
const PAYROLL_LOCK_SETUP_SQL = `
  ALTER TABLE payrolls ADD COLUMN IF NOT EXISTS is_locked boolean NOT NULL DEFAULT false;
  ALTER TABLE payrolls ADD COLUMN IF NOT EXISTS locked_at timestamptz;
  ALTER TABLE payrolls ADD COLUMN IF NOT EXISTS locked_by text;

  CREATE TABLE IF NOT EXISTS payroll_lock_snapshots (
    payroll_id uuid PRIMARY KEY REFERENCES payrolls(id) ON DELETE CASCADE,
    snapshot jsonb NOT NULL,
    created_at timestamptz DEFAULT now()
  );

  CREATE OR REPLACE FUNCTION prevent_locked_payroll_item_change() RETURNS trigger AS $fn$
  BEGIN
    IF EXISTS (SELECT 1 FROM payrolls WHERE id = OLD.payroll_id AND is_locked = true) THEN
      RAISE EXCEPTION 'Payroll is locked. Unlock it before changing its items.' USING ERRCODE = 'P0423';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END;
  $fn$ LANGUAGE plpgsql;

  DROP TRIGGER IF EXISTS trg_payroll_items_locked_guard ON payroll_items;
  CREATE TRIGGER trg_payroll_items_locked_guard
    BEFORE UPDATE OR DELETE ON payroll_items
    FOR EACH ROW EXECUTE FUNCTION prevent_locked_payroll_item_change();

  CREATE OR REPLACE FUNCTION prevent_locked_payroll_delete() RETURNS trigger AS $fn$
  BEGIN
    IF OLD.is_locked = true THEN
      RAISE EXCEPTION 'Payroll is locked. Unlock it before deleting.' USING ERRCODE = 'P0423';
    END IF;
    RETURN OLD;
  END;
  $fn$ LANGUAGE plpgsql;

  DROP TRIGGER IF EXISTS trg_payrolls_locked_delete_guard ON payrolls;
  CREATE TRIGGER trg_payrolls_locked_delete_guard
    BEFORE DELETE ON payrolls
    FOR EACH ROW EXECUTE FUNCTION prevent_locked_payroll_delete();
`;

// Runs once when the API starts. Every statement is idempotent, so a payroll database
// that already has the lock columns is left untouched. The promise is awaited by the
// lock routes so they never run before the columns exist.
const payrollLockSetupPromise: Promise<void> = (async () => {
  try {
    await payrollPool.query(PAYROLL_LOCK_SETUP_SQL);
    console.log('[LOCK] Payroll lock columns/triggers are ready.');
  } catch (err) {
    console.error('[LOCK] Could not set up payroll lock columns/triggers:', err);
  }
})();

// Returns true when the payroll that owns this payroll item is locked.
async function isPayrollItemLocked(client: any, payrollItemId: string): Promise<boolean> {
  await payrollLockSetupPromise;
  const r = await client.query(
    `SELECT p.is_locked
       FROM payroll_items pi
       JOIN payrolls p ON p.id = pi.payroll_id
      WHERE pi.id = $1`,
    [payrollItemId]
  );
  return r.rows[0]?.is_locked === true;
}

const PAYROLL_LOCKED_MESSAGE = 'This payroll is locked. Unlock it before making changes.';

async function writeLockAuditLog(action: string, payrollId: string, details: Record<string, unknown>, userEmail?: string | null) {
  try {
    await payrollPool.query(
      `INSERT INTO audit_logs (action, entity, entity_id, details, user_email) VALUES ($1, 'payrolls', $2, $3, COALESCE($4, 'admin@company.com'))`,
      [action, payrollId, JSON.stringify(details), userEmail || null]
    );
  } catch (err) {
    console.warn('[LOCK] Could not write audit log:', err instanceof Error ? err.message : err);
  }
}

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
// Given an employee's joining_date ('YYYY-MM-DD') and a payroll month/year,
// returns how many of that month's calendar days the employee was actually
// employed for. Mirrors the identical helper in src/pages/Payroll.tsx so the
// dashboard projection and the real generated payslip always agree.
function getEligibleDaysForMonthServer(
  joiningDate: string | null | undefined,
  month: number,
  year: number,
  calendarDays: number,
  relievingDate?: string | null | undefined
): number {
  let startDay = 1;
  let endDay = calendarDays;

  if (joiningDate) {
    const parts = String(joiningDate).split('-').map(Number);
    if (parts.length === 3 && !parts.some((n) => isNaN(n))) {
      const [jy, jm, jd] = parts;
      if (jy > year || (jy === year && jm > month)) return 0; // joins in a future month
      if (jy === year && jm === month) startDay = jd; // joined during this month
      // else: joined before this month — startDay stays 1
    }
  }

  if (relievingDate) {
    const parts = String(relievingDate).split('-').map(Number);
    if (parts.length === 3 && !parts.some((n) => isNaN(n))) {
      const [ry, rm, rd] = parts;
      if (ry < year || (ry === year && rm < month)) return 0; // relieved before this month
      if (ry === year && rm === month) endDay = rd; // relieved during this month
      // else: relieved after this month — endDay stays calendarDays
    }
  }

  return Math.max(0, endDay - startDay + 1);
}

router.get('/payroll-processing', async (req, res) => {
  const { month, year } = req.query;
  if (!month || !year) return res.status(400).json({ error: 'Month and year are required' });

  let pClient: any, tClient: any;
  try {
    pClient = await payrollPool.connect();
    tClient = timesheetPool ? await timesheetPool.connect() : null;

    // 1. Get all active employees (Sorted alphabetically)
    const empRes = await pClient.query('SELECT id, name, email, designation, department, employee_code, ctc, TO_CHAR(joining_date, \'YYYY-MM-DD\') AS joining_date, TO_CHAR(relieving_date, \'YYYY-MM-DD\') AS relieving_date FROM employees WHERE status = \'active\' ORDER BY name ASC');
    const employees = empRes.rows;

    // 1b. Fetch payroll settings (PF/ESI/Tax) and active advances so the projected salary
    // here matches the real Payroll page math exactly (approved leaves = no deduction, only
    // unpaid leaves/missing punches/sandwich Sundays are deducted, plus PF/ESI/Tax/Advance
    // deductions applied the same way).
    const settingsRes = await pClient.query('SELECT key, value FROM settings');
    const settingsMap = Object.fromEntries(settingsRes.rows.map((s: any) => [s.key, s.value || '']));
    const pfRate = parseFloat(settingsMap.pf_rate || '12');
    const esiRate = parseFloat(settingsMap.esi_rate || '0.75');
    const esiLimit = parseFloat(settingsMap.esi_limit || '21000');
    const taxRate = parseFloat(settingsMap.tax_rate || '10');

    const advancesRes = await pClient.query(
      `SELECT employee_id, installment_amount, balance, status, repayment_type
       FROM advances WHERE status = 'Active' AND balance > 0`
    );
    const advanceByEmp = new Map<string, number>();
    advancesRes.rows.forEach((adv: any) => {
      const inst = parseFloat(adv.installment_amount || 0);
      const bal = parseFloat(adv.balance || 0);
      const deduction = (adv.repayment_type === 'One-time' || inst === 0) ? bal : Math.min(inst, bal);
      if (deduction > 0) {
        advanceByEmp.set(adv.employee_id, (advanceByEmp.get(adv.employee_id) || 0) + deduction);
      }
    });

    // 1c. Get the same paid/unpaid day breakdown used by the Payroll page's generation preview
    // (approved leaves are paid/no-deduction there; only true unpaid days reduce salary).
    let previewSummaryMap = new Map<string, any>();
    try {
      const previewResult: any = await computePayrollPreviewData(employees.map((e: any) => e.id), Number(month), Number(year));
      (previewResult?.employees || []).forEach((e: any) => previewSummaryMap.set(e.id, e.summary));
    } catch (previewErr) {
      console.error('Error computing payroll preview summary for dashboard:', previewErr);
    }

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
            `SELECT TO_CHAR(CAST(date AS date), 'YYYY-MM-DD') as date_str, total_hours 
             FROM time_entries 
             WHERE employee_code = $1 AND CAST(date AS date) >= $2 AND CAST(date AS date) <= $3
               AND LOWER(status) NOT IN ('draft', 'rejected')`,
            [code, startDateStr, endDateStr]
          );

          // Group by distinct date first — some employees have more than one time_entries
          // row for the same date (duplicate/resynced submissions), which was previously
          // counted as multiple "recorded days" and could hide real missing days.
          const minutesByDate = new Map<string, number>();
          tsRes.rows.forEach((r: any) => {
            const hMatch = (r.total_hours || '').match(/(\d+)h/);
            const mMatch = (r.total_hours || '').match(/(\d+)m/);
            const mins = (hMatch ? parseInt(hMatch[1]) * 60 : 0) + (mMatch ? parseInt(mMatch[1]) : 0);
            minutesByDate.set(r.date_str, (minutesByDate.get(r.date_str) || 0) + mins);
          });

          let totalMinutes = 0;
          minutesByDate.forEach((mins) => {
            // Standard cap: 8 hours work (1 hr break already deducted or excluded)
            // Capping at 8 hours (480 mins) per day unless OT is implemented
            totalMinutes += Math.min(mins, 480);
          });

          totalHours = totalMinutes / 60;
          recordedDays = minutesByDate.size;
        } catch (e) {
          console.error(`Error fetching TS for ${code}:`, e);
        }
      }

      const ps = payslipMap.get(emp.id) as any;
      const leaveDays = leaveMap.get(code) || leaveMap.get(emailKey) || 0;
      const permissionHours = permMap.get(code) || permMap.get(emailKey) || 0;
      const biometricDays = bioMap.get(code) || 0;
      const missingDays = Math.max(0, expectedDays - recordedDays);

      // Salary Calculation — mirrors the Payroll page exactly: approved leaves are paid
      // (no deduction), only unpaid leaves / missing punches / sandwich Sundays reduce pay,
      // and PF/ESI/Tax/Advance deductions are applied the same way.
      const monthlySalary = (Number(emp.ctc || 0) / 12);
      const calendarDays = new Date(Number(year), Number(month), 0).getDate();

      // Mid-month joiner handling: prorate the projected salary the same way the
      // real generation step does, so this dashboard number isn't misleading for
      // employees who joined partway through the month.
      const eligibleDays = getEligibleDaysForMonthServer(emp.joining_date, Number(month), Number(year), calendarDays, emp.relieving_date);
      const isMidMonthJoiner = eligibleDays < calendarDays;

      const summary = previewSummaryMap.get(emp.id);
      let projectedNetSalary: number;

      if (summary) {
        const totalUnpaid = summary.unpaidDays || 0;
        const punchMissing = summary.punchMissing || 0;
        const sundayDeductions = summary.sundayDeductions || 0;
        const lessThan9 = summary.lessThan9 || 0;
        const nonLeaveDeductions = punchMissing + sundayDeductions + lessThan9;
        const unpaidLeaves = Math.max(0, totalUnpaid - nonLeaveDeductions);
        const effectiveMissingPunches = punchMissing + lessThan9;
        const advanceDeduction = advanceByEmp.get(emp.id) || 0;

        const calc = calculatePayroll({
          monthlySalary,
          workingDays: calendarDays,
          calendarDays,
          unpaidLeaves,
          missingTimesheets: 0,
          missingPunches: effectiveMissingPunches,
          bonus: 0,
          pfRate,
          esiRate,
          esiLimit,
          taxRate,
          loanDeduction: 0,
          advanceDeduction,
          sundayDeductions,
          calculationType: isMidMonthJoiner ? 'custom' : 'monthly',
          customDays: isMidMonthJoiner ? eligibleDays : 0
        });
        projectedNetSalary = calc.netSalary;
      } else if (isMidMonthJoiner) {
        // Fallback for mid-month joiners when preview data is unavailable —
        // still prorate to eligible days instead of showing a full month's pay.
        const dayRate = monthlySalary / calendarDays;
        projectedNetSalary = Math.max(0, dayRate * eligibleDays);
      } else {
        // Fallback if the preview data couldn't be computed (e.g. LMS unavailable) —
        // same simple fallback as before, so the panel never breaks.
        const dayRate = monthlySalary / calendarDays;
        projectedNetSalary = Math.max(0, monthlySalary - (missingDays * dayRate) - (leaveDays * dayRate));
      }

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
        isMidMonthJoiner,
        eligibleDays: isMidMonthJoiner ? eligibleDays : null,
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
  const { employeeId, payrollId, month, year, reason } = req.body;
  if (!employeeId || !reason) return res.status(400).json({ error: 'Employee ID and reason are required' });

  let client;
  try {
    client = await payrollPool.connect();

    // Find the payslip for this employee, scoped to the exact payroll run being viewed
    // (falls back to month/year only if payrollId wasn't supplied). Scoping by payrollId
    // matters when there are multiple payroll runs generated for the same month/year —
    // otherwise the wrong duplicate's payslip could get updated.
    const psRes = payrollId
      ? await client.query(
        `SELECT ps.id, e.email, e.name 
           FROM payslips ps
           JOIN employees e ON ps.employee_id = e.id
           WHERE ps.employee_id = $1 AND ps.payroll_id = $2`,
        [employeeId, payrollId]
      )
      : await client.query(
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
      const text = `Salary Hold Notification\n\nDear ${name},\n\nThis is to inform you that your salary for ${getMonthName(Number(month))} ${year} has been put on hold by the administration.\n\nReason for Hold:\n${reason}\n\nPlease contact the Admin or HR for further clarification.\n\nThis is an automated notification from the Payroll System.`;
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
      await sendEmail({ to: email, subject, html, text });
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
  const { employeeId, payrollId, month, year } = req.body;
  let client;
  try {
    client = await payrollPool.connect();
    if (payrollId) {
      await client.query(
        `UPDATE payslips SET status = 'draft', hold_reason = NULL 
         WHERE employee_id = $1 AND payroll_id = $2`,
        [employeeId, payrollId]
      );
    } else {
      await client.query(
        `UPDATE payslips SET status = 'draft', hold_reason = NULL 
         WHERE employee_id = $1 AND payroll_id IN (SELECT id FROM payrolls WHERE month=$2 AND year=$3)`,
        [employeeId, month, year]
      );
    }
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
    // TO_CHAR(...) overrides the raw `*` joining_date column with a plain
    // 'YYYY-MM-DD' string (last column wins when pg builds the row object).
    // Without this, node-postgres returns a Date, which JSON-serializes to a
    // full ISO timestamp that <input type="date"> can't parse — so the
    // Joining Date field silently shows blank when reopening Edit Employee.
    const result = await client.query(
      `SELECT *, TO_CHAR(joining_date, 'YYYY-MM-DD') AS joining_date, TO_CHAR(relieving_date, 'YYYY-MM-DD') AS relieving_date FROM employees ORDER BY name ASC`
    );
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
    relieving_date = null,
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
  const validRelievingDate = relieving_date && relieving_date !== "" ? relieving_date : null;

  let client;
  try {
    client = await payrollPool.connect();
    const insert = await client.query(
      `INSERT INTO employees (name, email, employee_code, ctc, reporting_manager, department, designation, joining_date, relieving_date, bank_name, bank_account, ifsc_code, pf_number, esi_number, uan_number, status, use_pa_sla, pa_sla_balance)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18) RETURNING *, TO_CHAR(joining_date, 'YYYY-MM-DD') AS joining_date, TO_CHAR(relieving_date, 'YYYY-MM-DD') AS relieving_date`,
      [name, email, employee_code || null, ctc, reporting_manager, department, designation, validJoiningDate, validRelievingDate, bank_name, bank_account, ifsc_code, pf_number, esi_number, uan_number, status, use_pa_sla, pa_sla_balance]
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
    relieving_date = null,
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
  const validRelievingDate = relieving_date && relieving_date !== "" ? relieving_date : null;

  let client;
  try {
    client = await payrollPool.connect();
    const update = await client.query(
      `UPDATE employees SET name=$1, email=$2, employee_code=$3, ctc=$4, reporting_manager=$5, department=$6, designation=$7, joining_date=$8, relieving_date=$9, bank_name=$10, bank_account=$11, ifsc_code=$12, pf_number=$13, esi_number=$14, uan_number=$15, status=$16, use_pa_sla=$17, pa_sla_balance=$18, updated_at=NOW()
       WHERE id=$19 RETURNING *, TO_CHAR(joining_date, 'YYYY-MM-DD') AS joining_date, TO_CHAR(relieving_date, 'YYYY-MM-DD') AS relieving_date`,
      [name, email, employee_code || null, ctc, reporting_manager, department, designation, validJoiningDate, validRelievingDate, bank_name, bank_account, ifsc_code, pf_number, esi_number, uan_number, status, use_pa_sla, pa_sla_balance, id]
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
      await client.query(
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


// Reusable attendance/leave summary computation — this is the single source of truth for
// "paid vs unpaid" day classification (approved leaves = no deduction, etc.). Used by both
// the /payroll/generation-preview endpoint (Payroll page) and /payroll-processing endpoint
// (Admin Panel dashboard) so both surfaces agree on the same numbers.
async function computePayrollPreviewData(employeeIds: string[], month: number, year: number) {
  let pClient, lmsClient, tsClient;
  try {
    pClient = await payrollPool.connect();
    lmsClient = await safeConnectOptionalPool(lmsPool);
    tsClient = await safeConnectOptionalPool(timesheetPool);

    // Fetch employees
    const empRes = await pClient.query('SELECT id, name, email, employee_code, ctc, use_pa_sla, pa_sla_balance, joining_date, relieving_date FROM employees WHERE id = ANY($1)', [employeeIds]);
    const employees = empRes.rows;

    // Helper to format date - Use UTC to avoid timezone shift
    // Helper to format local date (for date strings from DB that are already date-only)
    const formatLocalDate = (d: any) => {
      if (typeof d === 'string' && d.length === 10) return d; // Already YYYY-MM-DD
      const dt = new Date(d);
      return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    };

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
          SELECT TO_CHAR(d::date, 'YYYY-MM-DD') AS leave_date, l.leave_type, l.leave_duration_type, l.comp_off_uncovered_dates, l.comp_off_covered_days
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
          const isCompOff = (row.leave_type || '').trim().toLowerCase() === 'comp off';
          let isPaid = ['pl', 'sl', 'el', 'cl', 'sick', 'casual', 'earned', 'privilege', 'sick leave', 'casual leave', 'earned leave', 'privilege leave'].includes((row.leave_type || '').trim().toLowerCase());

          if (isCompOff) {
            const coveredDays = parseFloat(row.comp_off_covered_days || '0');
            if (row.comp_off_uncovered_dates) {
              const uncoveredDates = row.comp_off_uncovered_dates.split(',').map((s: string) => s.trim());
              if (!uncoveredDates.includes(dStr)) {
                isPaid = true; // It's covered by balance! No deduction.
              }
            } else if (coveredDays > 0) {
              // Legacy data: has covered days but no explicit uncovered_dates string. Assume covered to be safe.
              isPaid = true;
            }
            // If coveredDays === 0 and uncovered_dates is null, it remains isPaid = false (fully uncovered).
            console.log(`[DEBUG COMP OFF] Date: ${dStr}, coveredDays: ${coveredDays}, uncovered_dates: ${row.comp_off_uncovered_dates}, isPaid: ${isPaid}`);
          }

          empLeaves.set(dStr, {
            type: row.leave_type || 'Unknown',
            isPaid,
            duration: row.leave_duration_type,
            isCompOffUncovered: isCompOff && !isPaid
          });
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
        TO_CHAR(punch_time, 'YYYY-MM-DD') as att_date,
        MIN(punch_time) as first_punch,
        MAX(punch_time) as last_punch
       FROM attendance_logs
       WHERE punch_time >= $1::timestamp AND punch_time < $2::timestamp
       GROUP BY emp_code, TO_CHAR(punch_time, 'YYYY-MM-DD')`,
      [`${year}-${String(month).padStart(2, '0')}-01`, `${year + Math.floor(month / 12)}-${String((month % 12) + 1).padStart(2, '0')}-01`]
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
        joining_date: emp.joining_date ? formatLocalDate(emp.joining_date) : null,
        relieving_date: emp.relieving_date ? formatLocalDate(emp.relieving_date) : null,
        is_on_probation: false,
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
          nonWorkingPermissionHours: 0, // LMS permission hours on OD/leave/holiday/Sunday dates (counted against the 3h pool, not part of punch shortfall)
          halfDayLeaves: 0,
          // Hourly shortfall tracking (biometric hours vs required 9h/day)
          totalHoursMissing: 0,        // gross hours short of 9h/day across all attended-but-short days
          permissionCoveredHours: 0,   // of the above, hours covered by approved LMS permission / half-day / monthly 3h allowance (no deduction)
          deductibleShortfallHours: 0, // of the above, hours NOT covered — these get deducted (incl. LOP beyond 3h monthly cap)
          hourlyDeductionAmount: 0,    // rupee amount deducted for deductibleShortfallHours
          totalExcessHours: 0,          // total hours worked beyond 9h/day across all working days
          paSlaConsumed: 0,             // days of PA/SLA balance actually used this month to avoid a leave deduction
          plSlSandwichDays: 0           // Sundays where PL/SL Sandwich Rule applied (Sat + Mon both PL/SL leave)
        }
      };
      // Per-hour rate for the new hourly-shortfall deduction, based on a 9-hour working day
      const monthlySalaryForDed = Number(emp.ctc || 0) / 12;
      const daysInMonthForDed = endDate.getDate();
      const perDaySalaryForDed = daysInMonthForDed > 0 ? monthlySalaryForDed / daysInMonthForDed : 0;
      const perHourSalaryForDed = perDaySalaryForDed / 9;
      const empLeaves = lmsLeaves.get(emp.id) || new Map();
      const empTs = timesheets.get(emp.id) || new Set();
      const empAtt = attendance.get(emp.id) || new Map();
      const empPerms = lmsPermissions.get(emp.id) || new Map();
      let paSlaBalance = emp.use_pa_sla ? Number(emp.pa_sla_balance || 0) : 0;

      // Probation check: employees are on probation for their first 6 months
      // from their joining_date. While on probation they do NOT get the free
      // monthly 3-hour permission allowance — every permission/short-hour
      // minute is deductible, even though it would normally be covered.
      // (PL/SL still works as usual via the "Use PL/SL" checkbox — this only
      // affects the permission allowance.)
      const PROBATION_MONTHS = 6;
      let isOnProbation = false;
      if (empData.joining_date) {
        const [jy, jm, jd] = empData.joining_date.split('-').map(Number);
        const probationEndDate = new Date(jy, (jm - 1) + PROBATION_MONTHS, jd);
        const payrollPeriodEnd = new Date(year, month - 1, endDate.getDate());
        isOnProbation = payrollPeriodEnd < probationEndDate;
      }
      empData.is_on_probation = isOnProbation;

      // First pass: Calculate all days
      for (let d = 1; d <= endDate.getDate(); d++) {
        const curr = new Date(year, month - 1, d);
        // Use local date parts since curr is constructed with local year/month/day
        const dStr = `${curr.getFullYear()}-${String(curr.getMonth() + 1).padStart(2, '0')}-${String(curr.getDate()).padStart(2, '0')}`;

        // Employee joined the company after this date — they weren't employed
        // yet, so this day has no attendance/leave/timesheet expectation and
        // must not count toward payable days or any deduction.
        if (empData.joining_date && dStr < empData.joining_date) {
          empData.days.push({
            date: dStr,
            day: curr.toLocaleDateString('en-US', { weekday: 'short' }),
            punch_in: '-',
            punch_out: '-',
            total_hours: '0.0',
            required_hours: 9,
            attendance_status: 'Not Joined',
            timesheet_status: 'N/A',
            lms_leave_status: 'N/A',
            leave_type: '-',
            paid_unpaid: 'Not Joined',
            salary_deduction_applicable: false,
            deduction_reason: 'Before joining date',
            sunday_sandwich: false,
            pl_sl_sandwich: false,
            permission_status: 'None',
            permission_from: '-',
            permission_to: '-',
            permission_hours: '0.0',
            monthly_permission_used: '0.00',
            monthly_permission_remaining: '3.00',
            half_day_leave_status: 'None',
            eligible_hours: '0.00',
            deductible_short_hours: '0.00',
            hourly_deduction_amount: 0
          });
          continue;
        }

        // Employee's last working day (relieving date) was before this
        // date — they'd already left, so this day has no attendance/leave/
        // timesheet expectation and must not count toward payable days or
        // any deduction. Mirrors the "Not Joined" block above.
        if (empData.relieving_date && dStr > empData.relieving_date) {
          empData.days.push({
            date: dStr,
            day: curr.toLocaleDateString('en-US', { weekday: 'short' }),
            punch_in: '-',
            punch_out: '-',
            total_hours: '0.0',
            required_hours: 9,
            attendance_status: 'Relieved',
            timesheet_status: 'N/A',
            lms_leave_status: 'N/A',
            leave_type: '-',
            paid_unpaid: 'Relieved',
            salary_deduction_applicable: false,
            deduction_reason: 'After relieving date',
            sunday_sandwich: false,
            pl_sl_sandwich: false,
            permission_status: 'None',
            permission_from: '-',
            permission_to: '-',
            permission_hours: '0.0',
            monthly_permission_used: '0.00',
            monthly_permission_remaining: '3.00',
            half_day_leave_status: 'None',
            eligible_hours: '0.00',
            deductible_short_hours: '0.00',
            hourly_deduction_amount: 0
          });
          continue;
        }

        const isSunday = curr.getDay() === 0;
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
        let isUnpaidHalfDay = false;
        let isHalfDayMissing = false; // worked < HALF_DAY_MIN_HOURS with no leave: flat 0.5-day deduction (not permission / hourly)
        let permHours = perm ? perm.hours : 0;
        let allowanceUsedToday = 0;
        let deductibleShortHoursToday = 0;
        let hourlyDeductionToday = 0;
        let permHoursUsed = 0;
        let isPlSlSandwichDay = false;

        if (isHoliday) {
          paidUnpaid = 'Paid';
        } else if (isSunday) {
          // PL/SL Sandwich Rule: if the employee has a full-day PL/SL leave
          // applied (not OD, not Comp Off, not half-day) on BOTH the
          // surrounding Saturday and Monday, this Sunday is sandwiched too —
          // one extra PL/SL day is deducted from the balance for it. This is
          // judged from the raw LMS leave records (whether or not balance
          // ultimately covers Sat/Mon), and the balance is consumed here —
          // chronologically BEFORE Monday's own turn later in this loop — so
          // it charges Sat -> Sun(sandwich) -> Mon in real calendar order.
          const isPlSlEligibleLeave = (lv: any) => {
            if (!lv) return false;
            const t = (lv.type || '').toLowerCase().trim();
            if (t === 'od' || t === 'comp off') return false;
            if (lv.duration && lv.duration.toLowerCase().includes('half')) return false;
            return true;
          };
          let isSandwichSunday = false;
          if (d > 1 && d < endDate.getDate()) {
            const satDate = new Date(year, month - 1, d - 1);
            const monDate = new Date(year, month - 1, d + 1);
            const satStr = `${satDate.getFullYear()}-${String(satDate.getMonth() + 1).padStart(2, '0')}-${String(satDate.getDate()).padStart(2, '0')}`;
            const monStr = `${monDate.getFullYear()}-${String(monDate.getMonth() + 1).padStart(2, '0')}-${String(monDate.getDate()).padStart(2, '0')}`;
            isSandwichSunday = isPlSlEligibleLeave(empLeaves.get(satStr)) && isPlSlEligibleLeave(empLeaves.get(monStr));
          }

          if (isSandwichSunday) {
            isPlSlSandwichDay = true;
            empData.summary.plSlSandwichDays++;
            if (paSlaBalance >= 1) {
              paSlaBalance -= 1;
              empData.summary.paSlaConsumed += 1;
              paidUnpaid = 'Paid Leave (Sandwich)';
              dedReason = 'Sunday PL/SL Sandwich - 1 Day Deducted from PL/SL Balance';
            } else {
              isDeductible = true;
              paidUnpaid = 'Unpaid Sandwich (No PL/SL Balance)';
              dedReason = 'Sunday PL/SL Sandwich - No PL/SL Balance Remaining, Salary Deducted';
            }
          } else {
            paidUnpaid = 'Paid';
          }
        } else if (leave && (!leave.duration || !leave.duration.toLowerCase().includes('half'))) {
          // Full Day Leave
          if (leave.type.toLowerCase() === 'od') {
            paidUnpaid = 'Paid (OD)';
          } else if (leave.type.toLowerCase() === 'comp off') {
            if (leave.isCompOffUncovered) {
              lmsStatus = 'Approved (No Balance)';
              paidUnpaid = 'Unpaid Leave (Comp Off)';
              isDeductible = true;
              dedReason = 'Comp off applied but no comp off stored for you, so deducted';
            } else {
              paidUnpaid = 'Paid Leave (Comp Off)';
            }
          } else {
            if (paSlaBalance >= 1) {
              paSlaBalance -= 1;
              empData.summary.paSlaConsumed += 1;
              paidUnpaid = 'Paid Leave';
            } else {
              paidUnpaid = 'Unpaid Leave';
              isDeductible = true;
              dedReason = 'Unpaid Leave (' + leave.type + ')';
            }
          }
        } else {
          // Working Day or Half-Day Leave
          const isHalfDay = !!(leave && leave.duration && leave.duration.toLowerCase().includes('half'));
          const isHalfDayOD = isHalfDay && leave.type.toLowerCase() === 'od';
          // Half-day Comp Off: the leave half is covered by the stored comp off (not PL/SL balance)
          const isHalfDayCompOff = isHalfDay && leave.type.toLowerCase().trim() === 'comp off';
          const halfLeaveLabel = isHalfDayOD ? 'Approved Half-Day OD' : (isHalfDayCompOff ? 'Approved Half-Day Comp Off' : 'Approved Half-Day Leave');

          if (isHalfDay) {
            // Half-Day OD / Half-Day Leave: one half of the day is covered
            // (OD is always fully paid for that half; PL/SL leave is paid
            // for that half only if balance is available). The OTHER
            // ("balance") half of the day must still be covered by actual
            // biometric punch hours. If the balance half is short, it is a
            // flat half-day (0.5 day) salary deduction — e.g. Rs.500/day ->
            // Rs.250 deducted — never a proportional hourly deduction.
            // This balance-half shortfall is NEVER covered by
            // the monthly 3-hour permission allowance or by any approved
            // LMS permission hours, and never consumes/reduces that
            // monthly allowance ("balance half day will not come in the
            // permissions").
            halfDayHours = 4;
            let leaveHalfUnpaid = false;

            if (isHalfDayOD) {
              paidUnpaid = 'Paid (Half-Day OD)';
            } else if (isHalfDayCompOff) {
              if (leave.isCompOffUncovered) {
                // Same rule as a full-day Comp Off: no comp off stored -> that half is deducted
                lmsStatus = 'Approved (No Balance)';
                leaveHalfUnpaid = true;
                paidUnpaid = 'Unpaid Leave (Half-Day Comp Off)';
              } else {
                // Covered by comp off -> no deduction, PL/SL balance is NOT used
                paidUnpaid = 'Paid Leave (Half-Day Comp Off)';
              }
            } else if (paSlaBalance >= 0.5) {
              paSlaBalance -= 0.5;
              empData.summary.paSlaConsumed += 0.5;
              paidUnpaid = 'Paid Leave (Half-Day)';
            } else {
              leaveHalfUnpaid = true;
              paidUnpaid = 'Unpaid Leave (Half-Day)';
            }

            // Balance half is judged on raw biometric hours only.
            eligibleHours = totalHours + halfDayHours;
            const balanceHalfShortfall = Math.round((9 - eligibleHours) * 100) / 100;
            const balanceHalfUnpaid = balanceHalfShortfall > 0.01;
            if (balanceHalfUnpaid) {
              // Tracked for reporting only — the actual deduction is the
              // flat half-day below, not an hourly amount.
              deductibleShortHoursToday = balanceHalfShortfall;
            }

            if (leaveHalfUnpaid && balanceHalfUnpaid) {
              // Both halves unpaid — full day deducted
              isDeductible = true;
              paidUnpaid = 'Unpaid (Half-Day Leave + Balance Half-Day)';
              dedReason = isHalfDayCompOff
                ? 'Half-Day Comp Off applied but no comp off stored for you, and Balance Half-Day Not Worked - Full Day Deducted'
                : 'No PL/SL Balance for Half-Day Leave and Balance Half-Day Not Worked - Full Day Deducted';
            } else if (leaveHalfUnpaid) {
              isUnpaidHalfDay = true;
              dedReason = isHalfDayCompOff
                ? 'Half-Day Comp Off applied but no comp off stored for you - 0.5 Day Deducted'
                : 'No PL/SL Balance for Half-Day Leave - 0.5 Day Deducted';
            } else if (balanceHalfUnpaid) {
              isUnpaidHalfDay = true;
              dedReason = halfLeaveLabel +
                ' - Balance Half-Day Not Worked (Not Covered by Permission) - 0.5 Day Deducted';
            } else {
              dedReason = halfLeaveLabel + ' - No Deduction';
            }
          } else {
            // Rule aligned with the Knockturn "Permission Balance" card:
            // for each day the chargeable time is the LARGER of (a) the biometric
            // shortfall (9h - punched hours) and (b) the approved LMS permission
            // hours on that date. The monthly 3h allowance is consumed by that
            // chargeable time in date order; whatever is left over beyond the
            // allowance is deducted hourly. (Probation: no free allowance.)
            // A missing HALF DAY is a flat 0.5-day salary deduction. It never uses the
            // monthly 3h permission allowance and is not counted in the missing/permission
            // hours. Same convention as the half-day-leave rule above (9h - 4h half = 5h):
            // worked less than 5h on a normal working day = half day not worked.
            const HALF_DAY_MIN_HOURS = 5;
            if (totalHours > 0 && totalHours < HALF_DAY_MIN_HOURS) {
              isHalfDayMissing = true;
              isUnpaidHalfDay = true;
              eligibleHours = totalHours;
              paidUnpaid = 'Partially Paid (Half Day Not Worked)';
              dedReason = `Half day not worked (${totalHours.toFixed(1)}h < ${HALF_DAY_MIN_HOURS}h) - 0.5 Day Deducted (not counted in permission / missing hours)`;
            } else if (totalHours === 0 && permHours === 0) {
              // User requirement: deduct salary for missing punch in & out if no LMS leave applied
              paidUnpaid = 'Unpaid (Missing Punches)';
              isDeductible = true;
              dedReason = attStatus + ' (Salary Deducted)';
            } else {
              const shortfallToday = Math.max(0, 9 - totalHours);
              const chargeableToday = Math.round(Math.max(shortfallToday, permHours) * 100) / 100;
              const availableAllowance = isOnProbation ? 0 : Math.max(0, 3 - empData.summary.monthlyAllowanceUsed);
              const covered = Math.round(Math.min(chargeableToday, availableAllowance) * 100) / 100;
              allowanceUsedToday = covered;
              empData.summary.monthlyAllowanceUsed += covered;
              if (permHours > 0) permHoursUsed = Math.min(permHours, covered);
              eligibleHours = Math.min(9, totalHours + covered);
              const remainingCharge = Math.round((chargeableToday - covered) * 100) / 100;

              if (remainingCharge > 0.01) {
                deductibleShortHoursToday = remainingCharge;
                hourlyDeductionToday = Math.round(remainingCharge * perHourSalaryForDed * 100) / 100;
                paidUnpaid = 'Partially Paid (Hourly Deduction)';
                isDeductible = false; // day is still "attended"; deduction is hour-based
                if (isOnProbation) {
                  dedReason = `${remainingCharge.toFixed(2)}h chargeable (short hours / permission) — On Probation (no free permission allowance) — Hourly Salary Deduction`;
                } else if (empData.summary.monthlyAllowanceUsed >= 3) {
                  dedReason = `${remainingCharge.toFixed(2)}h beyond 3-Hour Monthly Permission Limit — Hourly Deduction`;
                } else {
                  dedReason = `${remainingCharge.toFixed(2)}h short after permission/allowance — Hourly Salary Deduction`;
                }
                empData.summary.permissionLimitExceededDays++;
              } else {
                paidUnpaid = 'Paid (Working)';
                if (covered > 0) {
                  dedReason = 'Within Monthly 3-Hour Permission Allowance - No Deduction';
                } else {
                  dedReason = null;
                }
              }
            }
          }
        }

        // Roll up hourly-shortfall tracking for the summary card (only for days actually attended and required to work)
        const isFullDayLeave = leave && (!leave.duration || !leave.duration.toLowerCase().includes('half'));
        if (totalHours > 0 && !isSunday && !isHoliday && !isFullDayLeave) {
          const requiredBiometricHours = 9 - halfDayHours;
          if (totalHours < requiredBiometricHours && !isHalfDayMissing) {
            const rawShort = Math.round((requiredBiometricHours - totalHours) * 100) / 100;
            empData.summary.totalHoursMissing += rawShort;
            empData.summary.permissionCoveredHours += Math.max(0, rawShort - deductibleShortHoursToday);
          }
          // Deductible hours / amount are rolled up for every attended day, because a
          // day can now be charged for its LMS permission hours even when the punch
          // shortfall is zero (Knockturn rule: max(shortfall, permission) per date).
          empData.summary.deductibleShortfallHours = Math.round((empData.summary.deductibleShortfallHours + deductibleShortHoursToday) * 100) / 100;
          empData.summary.hourlyDeductionAmount += hourlyDeductionToday;
          // Track excess hours (worked more than required)
          if (totalHours > requiredBiometricHours) {
            empData.summary.totalExcessHours += Math.round((totalHours - requiredBiometricHours) * 100) / 100;
          }
        }

        // Permission taken on a day that is NOT evaluated by the working-day logic
        // above (OD / full-day leave / holiday / Sunday) still counts against the
        // shared 3h monthly pool. Rule: each month an employee has 3h that can be
        // used as permission or to cover missing punch hours; anything beyond 3h is
        // LOP (hourly deduction). Probation: no free allowance.
        if (permHours > 0 && (isHoliday || isSunday || isFullDayLeave)) {
          const availableAllowance = isOnProbation ? 0 : Math.max(0, 3 - empData.summary.monthlyAllowanceUsed);
          const coveredPerm = Math.round(Math.min(permHours, availableAllowance) * 100) / 100;
          empData.summary.nonWorkingPermissionHours = Math.round((empData.summary.nonWorkingPermissionHours + permHours) * 100) / 100;
          allowanceUsedToday += coveredPerm;
          empData.summary.monthlyAllowanceUsed += coveredPerm;
          permHoursUsed += coveredPerm;
          const lopPermHours = Math.round((permHours - coveredPerm) * 100) / 100;
          if (lopPermHours > 0.01) {
            const lopAmount = Math.round(lopPermHours * perHourSalaryForDed * 100) / 100;
            deductibleShortHoursToday += lopPermHours;
            hourlyDeductionToday += lopAmount;
            empData.summary.deductibleShortfallHours = Math.round((empData.summary.deductibleShortfallHours + lopPermHours) * 100) / 100;
            empData.summary.hourlyDeductionAmount += lopAmount;
            empData.summary.permissionLimitExceededDays++;
            dedReason = (dedReason ? dedReason + ' | ' : '') + `${lopPermHours.toFixed(2)}h permission beyond 3-Hour Monthly limit — LOP (Hourly Deduction)`;
          } else if (coveredPerm > 0) {
            dedReason = (dedReason ? dedReason + ' | ' : '') + 'Permission within Monthly 3-Hour Allowance - No Deduction';
          }
        }

        if (permHoursUsed > 0) empData.summary.approvedPermissionHours += permHoursUsed;
        if (halfDayHours > 0) empData.summary.halfDayLeaves++;
        if (isDeductible && dedReason === 'Monthly 3-Hour Permission Limit Exceeded - Deductible') {
          empData.summary.permissionLimitExceededDays++;
        }

        if (isUnpaidHalfDay) {
          if (!isHalfDayMissing) paidUnpaid = 'Partially Paid (Unpaid Half Leave)';
          dedReason = (dedReason && !dedReason.includes('0.5 Day Deducted'))
            ? dedReason + ' | 0.5 Day Deducted'
            : (dedReason || 'Unpaid Half-Day Leave - 0.5 Day Deducted');
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
          pl_sl_sandwich: isPlSlSandwichDay,
          permission_status: perm ? 'Approved' : 'None',
          permission_from: perm?.from_time ? String(perm.from_time).substring(0, 5) : '-',
          permission_to: perm?.to_time ? String(perm.to_time).substring(0, 5) : '-',
          permission_hours: permHoursUsed.toFixed(1),
          monthly_permission_used: allowanceUsedToday.toFixed(2),
          monthly_permission_remaining: Math.max(0, 3 - empData.summary.monthlyAllowanceUsed).toFixed(2),
          half_day_leave_status: halfDayHours > 0 ? 'Approved (4h)' : 'None',
          eligible_hours: eligibleHours.toFixed(2),
          deductible_short_hours: deductibleShortHoursToday.toFixed(2),
          hourly_deduction_amount: hourlyDeductionToday,
          is_unpaid_half_day: isUnpaidHalfDay,
          on_probation: isOnProbation
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
      for (const day of empData.days) {
        if (day.attendance_status === 'Not Joined' || day.attendance_status === 'Relieved') {
          // Before joining / after relieving — excluded entirely, not payable and not deductible.
          continue;
        }
        if (day.salary_deduction_applicable) {
          empData.summary.unpaidDays++;
          if (day.sunday_sandwich) empData.summary.sundayDeductions++;
          else if (day.pl_sl_sandwich) { /* counted in plSlSandwichDays already — not a punch-missing day */ }
          else if (day.attendance_status === 'Less Than 9 Hours') empData.summary.lessThan9++;
          else if (!day.paid_unpaid.includes('Leave')) empData.summary.punchMissing++;
        } else {
          if (day.is_unpaid_half_day) {
            empData.summary.unpaidDays += 0.5;
          }
          empData.summary.totalPayable++;
          if (day.paid_unpaid.includes('Leave') && day.paid_unpaid.includes('Paid')) {
            empData.summary.paidLeaves++;
          }
        }
      }

      result.employees.push(empData);
    }

    return result;
  } finally {
    if (pClient) pClient.release();
    if (lmsClient) lmsClient.release();
    if (tsClient) tsClient.release();
  }
}

router.post('/payroll/generation-preview', async (req, res) => {
  const { employeeIds, month, year } = req.body;
  if (!employeeIds || !month || !year) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  try {
    const result = await computePayrollPreviewData(employeeIds, month, year);
    res.json(result);
  } catch (error) {
    console.error('Error generating payroll preview:', error);
    res.status(500).json({ error: 'Failed to generate payroll preview' });
  }
});

router.post('/payroll-items/external-data', async (req, res) => {
  const { employeeIds, month, year } = req.body;

  const leaveMap: Record<string, { employee_id: string; unpaid_leaves: number; total_leaves: number; paid_leaves: number; leave_type: string; leave_dates: string[]; pa_sla_consumed?: number; od_dates?: string[]; permission_hours?: number; dates?: string[] }> = {};
  const timesheetMap: Record<string, { employee_id: string; missing_days: number; submitted_at: string | null; missing_dates: string[]; unapproved_dates?: string[]; excluded_dates?: string[]; holiday_dates?: string[] }> = {};

  let pClient, lmsClient, timesheetClient;

  try {
    pClient = await payrollPool.connect();
    const namesRes = await pClient.query('SELECT id, name, email, employee_code, department, use_pa_sla, pa_sla_balance FROM employees WHERE id = ANY($1)', [employeeIds]);
    const empData = namesRes.rows;
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
              l.leave_duration_type,
              l.comp_off_uncovered_dates,
              l.comp_off_covered_days
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

            // Holidays that apply to this employee (all-department ones + their own department's).
            // A leave record covering a holiday date is not a leave day — holidays are paid for
            // everyone, including employees on probation.
            const leaveEmpDept = (emp.department || '').toLowerCase().trim();
            const leaveHolidaySet = new Set<string>(
              allHolidays
                .filter(h => !h.applicable_departments || h.applicable_departments.length === 0 || h.applicable_departments.map(x => x.toLowerCase().trim()).includes(leaveEmpDept))
                .map(h => h.date)
            );

            for (const row of leaveRes.rows) {
              const dt = new Date(row.leave_date);
              const d = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
              const dayValue = row.leave_duration_type === 'Half Day' ? 0.5 : 1.0;
              allLeaveDates.push(d);
              if (leaveHolidaySet.has(d)) continue; // holiday — paid for all, not a leave day
              totalCount += dayValue;
              leaveTypeSummary.push(row.leave_type);

              if (row.leave_type === 'OD') {
                // Paid leaves: no salary deduction, but still overlaps with TS missing to exclude
                odDates.push(d);
              } else if ((row.leave_type || '').trim().toLowerCase() === 'comp off') {
                const coveredDays = parseFloat(row.comp_off_covered_days || '0');
                if (row.comp_off_uncovered_dates) {
                  const uncoveredDates = row.comp_off_uncovered_dates.split(',').map((s: string) => s.trim());
                  if (uncoveredDates.includes(d)) {
                    unpaidCount += dayValue;
                  }
                } else if (coveredDays === 0) {
                  // completely uncovered!
                  unpaidCount += dayValue;
                }
              } else {
                // All other leave types (Casual, Sick, LWP, Earned) = unpaid
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

      // Admin setting: when ON, only days whose timesheet is approved (manager OR admin) count as worked.
      const timesheetApprovalRequired = await isTimesheetApprovalRequired(pClient);
      const tsRes = await timesheetClient.query(
        `SELECT x.employee_code,
                ARRAY_AGG(x.d) AS submitted_dates,
                ARRAY_AGG(x.d) FILTER (WHERE x.approved) AS approved_dates
         FROM (
           SELECT te.employee_code, CAST(te.date AS date) AS d, BOOL_AND(${TS_ENTRY_APPROVED_SQL}) AS approved
           FROM time_entries te
           WHERE UPPER(te.employee_code) = ANY($1) AND EXTRACT(MONTH FROM CAST(te.date as date)) = $2 AND EXTRACT(YEAR FROM CAST(te.date as date)) = $3
             AND LOWER(te.status) NOT IN ('draft', 'rejected')
           GROUP BY te.employee_code, CAST(te.date AS date)
         ) x
         GROUP BY x.employee_code`,
        [codes, month, year]
      );

      console.log(`[EXTERNAL-DATA] Found ${tsRes.rows.length} matches from timesheet DB`);

      const calendarDays = new Date(year, month, 0).getDate();
      for (const row of tsRes.rows) {
        const rowCode = (row.employee_code || '').toUpperCase();
        const empMatch = candidateMap.find((entry: any) => entry.codes.includes(rowCode));
        const emp = empMatch?.emp;

        if (emp) {
          const toYmd = (d: Date | string) => {
            const dt = new Date(d);
            return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
          };
          const submittedDatesSet = new Set<string>((row.submitted_dates || []).map(toYmd));
          const approvedDatesSet = new Set<string>((row.approved_dates || []).map(toYmd));
          // Approval ON → only approved days count as worked. OFF → any submitted day counts (unchanged).
          const workedDatesSet = timesheetApprovalRequired ? approvedDatesSet : submittedDatesSet;

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
          const unapprovedDates = timesheetApprovalRequired
            ? actualMissingDates.filter(d => submittedDatesSet.has(d))
            : [];

          const missing = actualMissingDates.length;

          console.log(`[EXTERNAL-DATA] ✅ MATCHED code ${row.employee_code} to employee ${emp.name} (${emp.id})`);
          console.log(`[EXTERNAL-DATA] Raw missing: ${rawMissingDates.length}, Excluded (on leave): ${excludedDates.length}, Final: ${missing}`);

          timesheetMap[emp.id] = {
            employee_id: emp.id,
            missing_days: missing,
            missing_dates: actualMissingDates,
            unapproved_dates: unapprovedDates,
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
// Supports optional ?from=YYYY-MM-DD&to=YYYY-MM-DD&emp_code=E0048 filtering so the
// query only pulls the punches actually needed, instead of always returning just the
// most recent 200 rows company-wide (which silently hid older records behind the
// frontend's date filters).
router.get('/attendance/logs', async (req, res) => {
  let client;
  try {
    client = await payrollPool.connect();

    const { from, to, emp_code } = req.query as { from?: string; to?: string; emp_code?: string };
    // Raised the default cap substantially since we now filter by date range/employee
    // in SQL; callers that truly want the old "just the latest N" behavior can still
    // pass ?limit=200 explicitly.
    const limit = Number(req.query.limit || '20000');

    const conditions: string[] = [];
    const params: any[] = [];

    if (from) {
      params.push(`${from} 00:00:00`);
      conditions.push(`punch_time >= $${params.length}`);
    }
    if (to) {
      params.push(`${to} 23:59:59`);
      conditions.push(`punch_time <= $${params.length}`);
    }
    if (emp_code && emp_code !== 'all') {
      params.push(emp_code);
      conditions.push(`emp_code = $${params.length}`);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(limit);

    const result = await client.query(
      `SELECT * FROM attendance_logs ${whereClause} ORDER BY punch_time DESC LIMIT $${params.length}`,
      params
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching attendance logs:', error);
    res.status(500).json({ error: 'Failed to fetch attendance logs' });
  } finally {
    if (client) client.release();
  }
});

// GET the distinct list of employee codes that have punches within a date range.
// Deliberately ignores any emp_code filter — used to populate the Employee dropdown
// on the Attendance page, so once you pick a specific employee the dropdown still
// shows every other employee (instead of collapsing to just the selected one,
// which happened when the dropdown was built from the already-filtered logs list).
router.get('/attendance/employees', async (req, res) => {
  let client;
  try {
    client = await payrollPool.connect();

    const { from, to } = req.query as { from?: string; to?: string };
    const conditions: string[] = [];
    const params: any[] = [];

    if (from) {
      params.push(`${from} 00:00:00`);
      conditions.push(`punch_time >= $${params.length}`);
    }
    if (to) {
      params.push(`${to} 23:59:59`);
      conditions.push(`punch_time <= $${params.length}`);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await client.query(
      `SELECT DISTINCT a.emp_code 
       FROM attendance_logs a
       JOIN employees e ON (a.emp_code = e.employee_code OR a.emp_code = CAST(e.id AS text))
       ${whereClause ? whereClause + " AND" : "WHERE"} e.status = 'active'
       ORDER BY a.emp_code`,
      params
    );

    res.json(result.rows.map((r: any) => r.emp_code));
  } catch (error) {
    console.error('Error fetching employee codes:', error);
    res.status(500).json({ error: 'Failed to fetch employee codes' });
  } finally {
    if (client) client.release();
  }
});

// GET approved leave dates from the LMS database for the given range/employee.
// Used by the Attendance page to distinguish a genuinely missing punch from a day
// the employee was on approved leave, so it can show "On Leave" instead of just
// "Missing Punch"/"Incomplete".
router.get('/attendance/leaves', async (req, res) => {
  if (!lmsPool) {
    // LMS not configured in this environment — return an empty list rather than
    // erroring, so the Attendance page still works (just without leave cross-check).
    return res.json([]);
  }

  let lmsClient;
  try {
    lmsClient = await lmsPool.connect();

    const { from, to, emp_code } = req.query as { from?: string; to?: string; emp_code?: string };

    const conditions: string[] = [`LOWER(l.status) = 'approved'`];
    const params: any[] = [];

    if (from) {
      params.push(from);
      conditions.push(`d::date >= $${params.length}::date`);
    }
    if (to) {
      params.push(to);
      conditions.push(`d::date <= $${params.length}::date`);
    }
    if (emp_code && emp_code !== 'all') {
      params.push(emp_code);
      conditions.push(`UPPER(TRIM(l.user_id)) = UPPER(TRIM($${params.length}))`);
    }

    const query = `
      SELECT
        UPPER(TRIM(l.user_id)) AS emp_code,
        d::date AS leave_date,
        l.leave_type,
        l.leave_duration_type
      FROM leaves l
      CROSS JOIN LATERAL (
        SELECT generate_series(CAST(l.start_date AS date), CAST(l.end_date AS date), '1 day'::interval)::date AS d
      ) dates
      WHERE ${conditions.join(' AND ')}
      ORDER BY d
    `;

    const result = await lmsClient.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching leave dates from LMS:', error);
    res.status(500).json({ error: 'Failed to fetch leave dates' });
  } finally {
    if (lmsClient) lmsClient.release();
  }
});

// Named (instead of an inline route callback) so the lock route can run the exact same
// live calculation once, at lock time, to capture the snapshot.
const payrollAnalysisHandler = async (req: any, res: any) => {
  const { payrollId } = req.params;
  // Only the lock route sets this: it needs the LIVE figures to snapshot, even though the
  // payroll is not locked yet. Normal requests never can.
  const forceLive = req.__forceLive === true;

  // Explicitly typed (rather than inferred) because these are now read inside the nested
  // async closure passed to Promise.all/.map() below — TS can't narrow an inferred-any
  // outer `let` across that function boundary, which otherwise surfaces as spurious
  // "implicitly has an 'any' type" errors at every usage site.
  let payrollClient: any, lmsClient: any, timesheetClient: any;

  try {
    payrollClient = await payrollPool.connect();

    // LOCKED payroll: serve the frozen snapshot captured when it was locked. Nothing is
    // recalculated, so later changes to settings, holidays, LMS leaves, timesheets,
    // attendance or employee records can never alter this payroll's figures.
    if (!forceLive) {
      await payrollLockSetupPromise;
      const lockRes = await payrollClient.query(
        `SELECT p.is_locked, s.snapshot
           FROM payrolls p
           LEFT JOIN payroll_lock_snapshots s ON s.payroll_id = p.id
          WHERE p.id = $1`,
        [payrollId]
      );
      const lockRow = lockRes.rows[0];
      if (lockRow?.is_locked && Array.isArray(lockRow.snapshot)) {
        // Hold / release is a status action (not a figure), so keep the payslip status live.
        const statusRes = await payrollClient.query(
          `SELECT ps.payroll_item_id, ps.status, ps.hold_reason FROM payslips ps WHERE ps.payroll_id = $1`,
          [payrollId]
        );
        const statusByItem = new Map<string, any>(statusRes.rows.map((r: any) => [r.payroll_item_id, r]));
        const frozen = lockRow.snapshot.map((row: any) => {
          const live = statusByItem.get(row.id);
          return live
            ? { ...row, payslip_status: live.status ?? null, payslip_hold_reason: live.hold_reason ?? null }
            : row;
        });
        return res.json(frozen);
      }
    }

    lmsClient = lmsPool ? await lmsPool.connect() : null;
    timesheetClient = timesheetPool ? await timesheetPool.connect() : null;

    // Build the TimeStrap employee-code map ONCE, up front — this used to be re-queried
    // (a full table scan of the TimeStrap `employees` table) inside the per-employee loop
    // below, so a payroll with N employees issued N redundant identical queries in serial.
    // That serial round-tripping (on top of the per-employee LMS/attendance queries also
    // done inside the loop) is what was blowing past connectionTimeoutMillis and surfacing
    // as "Connection terminated due to connection timeout" on this endpoint.
    const tsCodeMap = new Map<string, string>();
    const tsNameMap = new Map<string, string>();
    if (timesheetClient) {
      const tsEmpRes = await timesheetClient.query('SELECT name, email, employee_code FROM employees');
      tsEmpRes.rows.forEach((r: any) => {
        if (r.employee_code) {
          const code = r.employee_code.toUpperCase();
          if (r.email) tsCodeMap.set(r.email.toLowerCase(), code);
          if (r.name) tsNameMap.set(r.name.toLowerCase().trim(), code);
        }
      });
    }

    const payrollResult = await payrollClient.query('SELECT month, year FROM payrolls WHERE id=$1', [payrollId]);
    const payroll = payrollResult.rows[0];
    if (!payroll) {
      return res.status(404).json({ error: 'Payroll not found' });
    }

    // Admin setting: when ON, a timesheet day only counts if approved (manager OR admin).
    const timesheetApprovalRequired = await isTimesheetApprovalRequired(payrollClient);

    // Fetch holidays for the month to accurately compute missing days
    const holidayRes = await payrollClient.query(
      `SELECT date FROM holidays WHERE EXTRACT(MONTH FROM date) = $1 AND EXTRACT(YEAR FROM date) = $2`,
      [payroll.month, payroll.year]
    );
    // Helper: convert DB date/timestamp to local YYYY-MM-DD string without UTC timezone shift
    const toLocalDateStr = (d: Date | string): string => {
      const dt = new Date(d);
      return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    };
    const holidaySet = new Set(holidayRes.rows.map((r: any) => toLocalDateStr(r.date)));
    const holidayDatesAll = Array.from(holidaySet) as string[];

    const itemsResult = await payrollClient.query(
      `SELECT pi.*, e.id AS employee_id, e.name AS employee_name, e.email AS employee_email, e.designation AS employee_designation, e.department AS employee_department, e.bank_account AS employee_bank_account, e.pf_number AS employee_pf_number, e.uan_number AS employee_uan_number
       , e.employee_code AS employee_code, e.ctc AS employee_ctc, e.use_pa_sla AS employee_use_pa_sla, e.pa_sla_balance AS employee_pa_sla_balance, e.joining_date AS employee_joining_date, e.relieving_date AS employee_relieving_date
       , ps.status AS payslip_status, ps.hold_reason AS payslip_hold_reason
       FROM payroll_items pi
       JOIN employees e ON e.id = pi.employee_id
       LEFT JOIN payslips ps ON ps.payroll_item_id = pi.id
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

    // Process employees with BOUNDED concurrency (5 at a time) instead of either fully serial
    // (the original code — safe but slow: 4 round trips × N employees, none overlapping) or
    // fully unbounded parallel (tried next — fast, but opened up to N simultaneous connections
    // against the LMS/TimeStrap databases and could exhaust their connection limits). 5 in
    // flight at once gives most of the speed-up with a small, predictable connection footprint.
    const ANALYSIS_CONCURRENCY = 5;
    const enriched = await mapWithConcurrency(itemsResult.rows as (PayrollItemAnalysisRow & { monthly_salary: number })[], ANALYSIS_CONCURRENCY, async (item) => {
      const monthlySalary = item.monthly_salary || 0;
      let leaveData: { unpaid_leaves?: number; leave_type?: string; leave_dates?: string[]; od_dates?: string[]; permission_hours?: number } | null = null;
      let tsData: { missing_days?: number; submitted_at?: string | null; missing_dates?: string[]; unapproved_dates?: string[]; excluded_dates?: string[] } | null = null;

      // If this employee's joining date falls within the payroll month, don't
      // count any day before it as a missing timesheet/punch day — they simply
      // weren't employed yet. Employees who joined before this month are
      // unaffected (joiningDateStr will be earlier than every date checked).
      const employeeJoiningDate = (item as any).employee_joining_date;
      const joiningDateStr: string | null = employeeJoiningDate ? toLocalDateStr(employeeJoiningDate) : null;

      // Same idea, mirrored for the other end of employment: if this
      // employee's relieving date (last working day) falls within the
      // payroll month, don't count any day after it as a missing
      // timesheet/punch day — they'd already left. Employees who are still
      // active (no relieving date) are unaffected.
      const employeeRelievingDate = (item as any).employee_relieving_date;
      const relievingDateStr: string | null = employeeRelievingDate ? toLocalDateStr(employeeRelievingDate) : null;

      // Use stored excluded/holiday dates if already saved (for current payrolls)
      const storedExcludedDates: string[] = (item.timesheet_excluded_dates as any) || [];

      if (lmsClient) {
        try {
          const leaveQuery = `
            SELECT 
              d::date AS leave_date,
              l.leave_type,
              l.leave_duration_type,
              l.comp_off_uncovered_dates,
              l.comp_off_covered_days
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
            ORDER BY d
          `;
          const empCode = (item as any).employee_code || '';
          console.log(`[ANALYSIS] LMS query for ${item.employee_name}, code: ${empCode}`);
          // Use the pool (not the single shared lmsClient) so this employee's query can run
          // concurrently with every other employee's — see Promise.all note above the loop.
          const leaveRes = await lmsPool!.query(leaveQuery, [payroll.month, payroll.year, item.employee_name, empCode]);
          if (leaveRes.rows.length > 0) {
            const allLeaveDates: string[] = [];
            const odDates: string[] = [];
            const halfDayLeaveDates: string[] = [];
            const paidByBalanceDates: string[] = [];
            let unpaidCount = 0;
            let totalCount = 0;
            let paSlaConsumed = 0;
            const leaveTypeSummary: string[] = [];

            // Same gating rule used in computePayrollPreviewData (the function that actually
            // runs at payroll-generation time): a leave day (other than OD/Comp Off) is only
            // exempt from deduction if the employee's "Use PL/SL" checkbox is ticked AND they
            // have enough PA/SLA balance left. Balance is consumed day by day in chronological
            // order (rows are pre-sorted by date via ORDER BY d in the query above).
            let paSlaBalance = (item as any).employee_use_pa_sla ? Number((item as any).employee_pa_sla_balance || 0) : 0;

            for (const row of leaveRes.rows) {
              const d = toLocalDateStr(row.leave_date);
              const dayValue = row.leave_duration_type === 'Half Day' ? 0.5 : 1.0;
              allLeaveDates.push(d);
              // A company/government holiday is paid for EVERYONE (probation included). A leave
              // record that happens to cover a holiday date must not be counted as leave, must not
              // become "unpaid" for someone with no PL/SL balance, and must not eat PL/SL balance.
              // (The date stays in allLeaveDates so the other date-based checks behave as before.)
              if (holidaySet.has(d)) continue;
              leaveTypeSummary.push(row.leave_type);
              if (row.leave_duration_type === 'Half Day') {
                halfDayLeaveDates.push(d);
              }
              const normalizedType = (row.leave_type || '').trim().toLowerCase();

              if (row.leave_type === 'OD') {
                // OD (On Duty) is not leave — it's shown as its own separate line in the UI,
                // so it must NOT be added to totalCount or the "Leave Taken" figure will
                // double-count it (once in the total, once again in the "+Xd OD" line).
                odDates.push(d);
              } else if (normalizedType === 'comp off') {
                totalCount += dayValue;
                const coveredDays = parseFloat(row.comp_off_covered_days || '0');
                if (row.comp_off_uncovered_dates) {
                  const uncoveredDates = row.comp_off_uncovered_dates.split(',').map((s: string) => s.trim());
                  if (uncoveredDates.includes(d)) {
                    unpaidCount += dayValue;
                  }
                } else if (coveredDays === 0) {
                  unpaidCount += dayValue;
                }
              } else {
                totalCount += dayValue;
                if (paSlaBalance >= dayValue) {
                  // Checkbox ticked AND enough balance — this day is protected, no deduction.
                  paSlaBalance -= dayValue;
                  paSlaConsumed += dayValue;
                  paidByBalanceDates.push(d);
                } else {
                  // Checkbox unticked, or balance exhausted — genuinely unpaid leave,
                  // regardless of whether it's marked PL/SL in the LMS.
                  unpaidCount += dayValue;
                }
              }
            }

            const uniqueAllLeaveDates = [...new Set(allLeaveDates)];
            const primaryLeaveType = leaveTypeSummary.find(t => t !== 'OD') || leaveTypeSummary[0] || 'Leave';
            const uncoveredCompOffDates: string[] = [];

            for (const row of leaveRes.rows) {
              const d = toLocalDateStr(row.leave_date);
              if ((row.leave_type || '').trim().toLowerCase() === 'comp off') {
                const coveredDays = parseFloat(row.comp_off_covered_days || '0');
                if (row.comp_off_uncovered_dates) {
                  const uncoveredDates = row.comp_off_uncovered_dates.split(',').map((s: string) => s.trim());
                  if (uncoveredDates.includes(d)) {
                    uncoveredCompOffDates.push(d);
                  }
                } else if (coveredDays === 0) {
                  uncoveredCompOffDates.push(d);
                }
              }
            }

            console.log(`[ANALYSIS] LMS Match for ${item.employee_name}: ${totalCount} total, ${unpaidCount} unpaid, ${paSlaConsumed} paid via PA/SLA balance, ${odDates.length} OD dates, ${halfDayLeaveDates.length} half-day`);
            leaveData = {
              unpaid_leaves: unpaidCount,
              total_leaves: totalCount,
              leave_type: primaryLeaveType,
              leave_dates: uniqueAllLeaveDates,
              od_dates: odDates,
              half_day_leave_dates: halfDayLeaveDates,
              permission_hours: 0,
              comp_off_uncovered_dates: uncoveredCompOffDates,
              pa_sla_consumed: paSlaConsumed,
              paid_by_balance_dates: paidByBalanceDates,
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
          const permRes = await lmsPool!.query(permQuery, [payroll.month, payroll.year, item.employee_name, (item as any).employee_code || '']);
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
          // tsCodeMap / tsNameMap are built once, above, outside this loop.
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
            // `approved` = every (non-draft / non-rejected) entry of that day is approved by the
            // manager OR the admin. Only consulted when the "timesheet approval required"
            // setting is ON; with it OFF, any submitted day counts as worked (unchanged).
            const tsRes = await timesheetPool!.query(
              `SELECT CAST(te.date AS date) AS d, BOOL_AND(${TS_ENTRY_APPROVED_SQL}) AS approved
               FROM time_entries te
               WHERE UPPER(te.employee_code) = ANY($1) AND EXTRACT(MONTH FROM CAST(te.date as date)) = $2 AND EXTRACT(YEAR FROM CAST(te.date as date)) = $3
                 AND LOWER(te.status) NOT IN ('draft', 'rejected')
               GROUP BY CAST(te.date AS date)`,
              [lookupCodes, payroll.month, payroll.year]
            );

            if (tsRes.rows.length > 0) {
              // Employee has submitted some timesheet entries — compute missing days normally
              const submittedDatesSet = new Set(tsRes.rows.map((r: any) => toLocalDateStr(r.d)));
              const approvedDatesSet = new Set(tsRes.rows.filter((r: any) => r.approved === true).map((r: any) => toLocalDateStr(r.d)));
              // Approval ON → only approved days count as worked. OFF → any submitted day counts.
              const workedDatesSet = timesheetApprovalRequired ? approvedDatesSet : submittedDatesSet;
              const notApprovedDates: string[] = [];
              for (let d = 1; d <= calendarDays; d++) {
                const dt = new Date(payroll.year, payroll.month - 1, d);
                const dstr = `${payroll.year}-${String(payroll.month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                if (dt.getDay() === 0) continue;
                if (holidaySet.has(dstr)) continue;
                if (joiningDateStr && dstr < joiningDateStr) continue; // not employed yet
                if (relievingDateStr && dstr > relievingDateStr) continue; // already relieved
                if (!workedDatesSet.has(dstr)) {
                  missingDates.push(dstr);
                  if (timesheetApprovalRequired && submittedDatesSet.has(dstr)) notApprovedDates.push(dstr);
                }
              }
              console.log(`[ANALYSIS] ✅ Found ${tsRes.rows.length} submitted days for ${item.employee_name}, missing ${missingDates.length}${timesheetApprovalRequired ? ` (of which ${notApprovedDates.length} submitted but not approved)` : ''}`);
              tsData = {
                missing_days: missingDates.length,
                missing_dates: missingDates,
                unapproved_dates: notApprovedDates,
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
                if (joiningDateStr && dstr < joiningDateStr) continue; // not employed yet
                if (relievingDateStr && dstr > relievingDateStr) continue; // already relieved
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
      let unapprovedMissingDates: string[] = [];
      let timesheetDeduction: number;

      if (tsData !== null && tsData.missing_dates) {
        // We have live TS data — compute overlap with leave dates
        const rawMissingDates = tsData.missing_dates;
        const excludedByLeave = rawMissingDates.filter((d: string) => leaveDateSet.has(d));
        actualMissingDates = rawMissingDates.filter((d: string) => !leaveDateSet.has(d));
        actualMissingTsDays = actualMissingDates.length;
        finalExcludedDates = excludedByLeave;
        // Of the days that are still deductible, which ones were actually submitted but not approved
        // (only ever non-empty when the approval-required setting is ON).
        const unapprovedSet = new Set(tsData.unapproved_dates || []);
        unapprovedMissingDates = actualMissingDates.filter((d: string) => unapprovedSet.has(d));

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

      // --- Timesheet Exception ---
      // Admins can waive the deduction for some or all of an employee's missing
      // timesheet days. 'full' waives the deduction for every missing day found
      // above (so a fresh refresh with more/fewer missing days still applies the
      // waiver automatically); 'partial' waives a fixed number of days, capped at
      // the actual missing day count.
      const tsExceptionType: string = (item as any).timesheet_exception_type || 'none';
      const tsExceptionDaysStored = Number((item as any).timesheet_exception_days) || 0;
      let tsExceptionDaysApplied = 0;
      if (tsExceptionType === 'full' && actualMissingTsDays > 0) {
        tsExceptionDaysApplied = actualMissingTsDays;
      } else if (tsExceptionType === 'partial' && actualMissingTsDays > 0) {
        tsExceptionDaysApplied = Math.min(tsExceptionDaysStored, actualMissingTsDays);
      }
      if (tsExceptionDaysApplied > 0) {
        const perDayRateForException = (monthlySalary || 0) / (calendarDays || 30);
        timesheetDeduction = Math.round(
          (actualMissingTsDays - tsExceptionDaysApplied) * perDayRateForException * 100
        ) / 100;
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
      // Manual, admin-entered carry-forward balance from a previous month.
      // Preserve it across regeneration exactly like bonus — it's not derived
      // from attendance/LMS data so there's nothing to recompute here.
      const previousMonthBalance = Number((item as any).previous_month_balance) || 0;

      const permissionHours = leaveData?.permission_hours ?? Number(item.permission_hours) ?? 0;
      // IMPORTANT: permission hours are already accounted for inside `hourly_deduction`
      // (computed at Generate Payroll time via the day-by-day 9h/day + 3h/month-allowance
      // model). Do NOT recompute a separate flat-rule deduction here from the raw monthly
      // permission total — doing so deducted the same permission hours a second time
      // (once inside hourly_deduction, once again as permission_deduction), causing net
      // salary to be lower than what was actually generated. Just reuse the stored value.
      const permissionDeduction = Number(item.permission_deduction) || 0;

      // --- Missing Punch Detection ---
      // Check attendance_logs for days with NO punch at all (no punch in, no punch out)
      // Cross-reference with LMS approved leaves: if leave is approved for that day, no deduction
      const empCode = (item as any).employee_code || '';
      let missingPunchDays = 0;
      let missingPunchDeduction = 0;
      const missingPunchDates: string[] = [];
      let missingPunchExceptedDatesApplied: string[] = [];
      const coveredByLeaveDates: string[] = []; // Missing punch days covered by approved leave
      const fullyPunchedDatesSet = new Set();
      const incompletePunchedDatesSet = new Set<string>();
      const incompletePunchTimes: Record<string, string> = {};
      let sandwichDeductedDays = 0;
      let sandwichDeductionAmount = 0;
      const sandwichDates: string[] = [];

      if (empCode) {
        try {
          // Get all dates this employee has attendance records for
          const attRes = await payrollPool.query(
            `SELECT 
               TO_CHAR(punch_time, 'YYYY-MM-DD') as att_date,
               MIN(punch_time) as first_punch,
               MAX(punch_time) as last_punch
             FROM attendance_logs
             WHERE UPPER(emp_code) = UPPER($1)
               AND EXTRACT(MONTH FROM punch_time) = $2
               AND EXTRACT(YEAR FROM punch_time) = $3
             GROUP BY TO_CHAR(punch_time, 'YYYY-MM-DD')`,
            [empCode, payroll.month, payroll.year]
          );

          attRes.rows.forEach((r: any) => {
            const pIn = new Date(r.first_punch);
            const pOut = new Date(r.last_punch);
            if (pIn.getTime() === pOut.getTime()) {
              incompletePunchedDatesSet.add(r.att_date);
              incompletePunchTimes[r.att_date] = pIn.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
            } else {
              fullyPunchedDatesSet.add(r.att_date);
            }
          });

          // Find working days with NO punch or INCOMPLETE punch
          for (let d = 1; d <= calendarDays; d++) {
            const dt = new Date(payroll.year, payroll.month - 1, d);
            const dstr = `${payroll.year}-${String(payroll.month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            if (dt.getDay() === 0) continue; // Skip Sunday
            if (holidaySet.has(dstr)) continue; // Skip holidays
            if (joiningDateStr && dstr < joiningDateStr) continue; // Not employed yet
            if (relievingDateStr && dstr > relievingDateStr) continue; // Already relieved
            if (fullyPunchedDatesSet.has(dstr)) continue; // Has full punch, skip

            // This day has NO full punch (either no punch or incomplete punch)
            if (leaveDateSet.has(dstr)) {
              // Covered by approved leave - no deduction
              coveredByLeaveDates.push(dstr);
            } else {
              // No full punch AND no leave - this is a deductible missing punch day
              missingPunchDates.push(dstr);
            }
          }

          missingPunchDays = missingPunchDates.length;
          const perDaySalary = (monthlySalary || 0) / (calendarDays || 30);
          missingPunchDeduction = Math.round(perDaySalary * missingPunchDays * 100) / 100;

          // --- Missing Punch Exception ---
          // Admins can waive the deduction for individual missing-punch days
          // (chosen via checkboxes in the UI). Only dates that are still
          // actually missing count — if a previously-excepted date is no
          // longer missing (e.g. attendance data was corrected), it's simply
          // ignored rather than affecting anything.
          const mpExceptionDatesRaw = (item as any).missing_punch_exception_dates;
          const mpExceptionDatesStored: string[] = Array.isArray(mpExceptionDatesRaw)
            ? mpExceptionDatesRaw
            : (typeof mpExceptionDatesRaw === 'string' && mpExceptionDatesRaw
              ? (() => { try { return JSON.parse(mpExceptionDatesRaw); } catch { return []; } })()
              : []);
          const mpExceptedSet = new Set(mpExceptionDatesStored);
          missingPunchExceptedDatesApplied = missingPunchDates.filter((d) => mpExceptedSet.has(d));
          if (missingPunchExceptedDatesApplied.length > 0) {
            const payableMissingPunchDays = missingPunchDays - missingPunchExceptedDatesApplied.length;
            missingPunchDeduction = Math.round(perDaySalary * payableMissingPunchDays * 100) / 100;
          }

          // Sandwich Deduction: if Saturday and Monday have NO punches, deduct Sunday
          // NOTE: A Saturday/Monday covered by approved leave or OD (leaveDateSet — which
          // already includes OD dates, see uniqueAllLeaveDates above) is NOT an unpaid
          // absence, so it must never trigger the Sunday sandwich deduction — this mirrors
          // the main day-by-day generation logic, which only sandwich-deducts Sunday when
          // both Saturday AND Monday are confirmed salary-deductible unpaid absence days.
          for (let d = 2; d <= calendarDays - 1; d++) {
            const dt = new Date(payroll.year, payroll.month - 1, d);
            if (dt.getDay() === 0) { // Sunday
              const sunStr = `${payroll.year}-${String(payroll.month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
              if (joiningDateStr && sunStr < joiningDateStr) continue; // Not employed yet — never sandwich-deduct a pre-joining Sunday
              if (relievingDateStr && sunStr > relievingDateStr) continue; // Already relieved — never sandwich-deduct a post-relieving Sunday
              const satStr = `${payroll.year}-${String(payroll.month).padStart(2, '0')}-${String(d - 1).padStart(2, '0')}`;
              const monStr = `${payroll.year}-${String(payroll.month).padStart(2, '0')}-${String(d + 1).padStart(2, '0')}`;

              if (leaveDateSet.has(satStr) || leaveDateSet.has(monStr)) continue; // Sat or Mon covered by approved leave/OD — not an unpaid absence, skip

              const satNoPunch = !fullyPunchedDatesSet.has(satStr) && !incompletePunchedDatesSet.has(satStr);
              const monNoPunch = !fullyPunchedDatesSet.has(monStr) && !incompletePunchedDatesSet.has(monStr);

              if (satNoPunch && monNoPunch) {
                sandwichDates.push(sunStr);
              }
            }
          }
          sandwichDeductedDays = sandwichDates.length;
          sandwichDeductionAmount = Math.round(perDaySalary * sandwichDeductedDays * 100) / 100;

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
      const hourlyDeductionStored = Number(item.hourly_deduction) || 0;

      // Mid-month joiner/leaver: shrink the base salary to only the days the
      // employee was actually employed this month (joining date → relieving
      // date, or month end if still active), the same way the original
      // generation step does. Without this, an employee who joined or was
      // relieved partway through the month would have every attendance/leave
      // deduction correctly limited to their eligible days, but the base pay
      // itself would still be the FULL month's salary — wildly overstating
      // their net salary on this live-recomputed analysis view.
      const eligibleDaysForPay = (() => {
        let startDay = 1;
        let endDay = calendarDays;

        if (joiningDateStr) {
          const parts = joiningDateStr.split('-').map(Number);
          if (parts.length === 3 && !parts.some((n) => isNaN(n))) {
            const [jy, jm, jd] = parts;
            if (jy > payroll.year || (jy === payroll.year && jm > payroll.month)) return 0; // joins in a future month
            if (jy === payroll.year && jm === payroll.month) startDay = jd; // joined during this month
            // else: joined before this month — startDay stays 1
          }
        }

        if (relievingDateStr) {
          const parts = relievingDateStr.split('-').map(Number);
          if (parts.length === 3 && !parts.some((n) => isNaN(n))) {
            const [ry, rm, rd] = parts;
            if (ry < payroll.year || (ry === payroll.year && rm < payroll.month)) return 0; // relieved before this month
            if (ry === payroll.year && rm === payroll.month) endDay = rd; // relieved during this month
            // else: relieved after this month — endDay stays calendarDays
          }
        }

        return Math.max(0, endDay - startDay + 1);
      })();
      const baseSalaryForPay = ((monthlySalary || 0) / (calendarDays || 30)) * eligibleDaysForPay;

      const netSalary = Math.max(
        0,
        Math.round((baseSalaryForPay - leaveDeduction - timesheetDeduction - missingPunchDeduction - sandwichDeductionAmount - permissionDeduction - hourlyDeductionStored - pfDeduction - esiDeduction - taxDeduction - loanDeduction - advanceDeduction + bonus + previousMonthBalance + sundayEarnings) * 100) / 100
      );

      return {
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
          employee_code: (item as any).employee_code,
          ctc: (item as any).employee_ctc,
          joining_date: joiningDateStr,
          relieving_date: relievingDateStr,
        },
        unpaid_leaves: leaveData?.unpaid_leaves ?? item.unpaid_leaves,
        total_leaves: (leaveData as any)?.total_leaves ?? item.unpaid_leaves,
        paid_leaves: Math.max(0, ((leaveData as any)?.total_leaves ?? item.unpaid_leaves) - (leaveData?.unpaid_leaves ?? item.unpaid_leaves)),
        pa_sla_consumed: (leaveData as any)?.pa_sla_consumed ?? 0,
        leave_source: leaveData ? `LMS (${(leaveData as any).leave_type})` : 'No LMS leave record',
        leave_type: (leaveData as any)?.leave_type ?? null,
        od_dates: (leaveData as any)?.od_dates ?? [],
        half_day_leave_dates: (leaveData as any)?.half_day_leave_dates ?? [],
        leave_matched_ts_dates: leaveData?.leave_dates ?? [],
        uncovered_comp_off_dates: (leaveData as any)?.comp_off_uncovered_dates ?? [],
        missing_timesheets: actualMissingTsDays,
        missing_dates: actualMissingDates,
        leave_matched_ts_days: leaveMatchedTsDays,
        timesheet_deduction: timesheetDeduction,
        timesheet_exception_type: tsExceptionType,
        timesheet_exception_days: tsExceptionDaysStored,
        timesheet_exception_days_applied: tsExceptionDaysApplied,
        timesheet_exception_note: (item as any).timesheet_exception_note || null,
        timesheet_exception_granted_at: (item as any).timesheet_exception_granted_at || null,
        missing_punches: missingPunchDays,
        missing_punch_deduction: missingPunchDeduction,
        missing_punch_dates: missingPunchDates,
        missing_punch_exception_dates: missingPunchExceptedDatesApplied,
        missing_punch_exception_note: (item as any).missing_punch_exception_note || null,
        missing_punch_exception_granted_at: (item as any).missing_punch_exception_granted_at || null,
        incomplete_punch_dates: Array.from(incompletePunchedDatesSet),
        incomplete_punch_times: incompletePunchTimes,
        covered_by_leave_dates: coveredByLeaveDates,
        sandwich_deducted_days: sandwichDeductedDays,
        sandwich_deduction_amount: sandwichDeductionAmount,
        sandwich_dates: sandwichDates,
        permission_hours: permissionHours,
        permission_deduction: permissionDeduction,
        payslip_status: (item as any).payslip_status ?? null,
        payslip_hold_reason: (item as any).payslip_hold_reason ?? null,
        hourly_short_hours: Number(item.hourly_short_hours) || 0,
        hourly_deduction: Number(item.hourly_deduction) || 0,
        previous_month_balance: previousMonthBalance,
        net_salary: netSalary,
        timesheet_status: !tsData?.submitted_at
          ? 'Not submitted'
          : (timesheetApprovalRequired && unapprovedMissingDates.length > 0
              ? `Submitted (${unapprovedMissingDates.length} day${unapprovedMissingDates.length === 1 ? '' : 's'} not approved)`
              : 'Submitted'),
        timesheet_submitted_at: tsData?.submitted_at || null,
        // Days the employee submitted a timesheet but it is not approved (manager or admin) yet.
        // These are ALSO included in missing_dates / missing_timesheets and deducted as LOP when
        // the approval-required setting is ON. Always [] when the setting is OFF.
        timesheet_unapproved_dates: unapprovedMissingDates,
        timesheet_approval_required: timesheetApprovalRequired,
        timesheet_excluded_dates: finalExcludedDates,
        holiday_dates: finalHolidayDates,
        leave_dates: leaveDatesArray,
      };
    });

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
};

router.get('/payroll-items/analysis/:payrollId', payrollAnalysisHandler);

// ─── Lock / Unlock a generated payroll ────────────────────────────────────────
router.post('/payroll/:id/lock', async (req, res) => {
  const { id } = req.params;
  const lockedBy: string | null = (req.body && typeof req.body.locked_by === 'string' && req.body.locked_by.trim()) || null;

  let client: any;
  try {
    await payrollLockSetupPromise;
    client = await payrollPool.connect();

    const existing = await client.query('SELECT id, is_locked, month, year FROM payrolls WHERE id = $1', [id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Payroll not found' });
    if (existing.rows[0].is_locked) return res.json({ success: true, alreadyLocked: true });

    // Capture the live figures exactly as the analysis screen shows them right now.
    let captured: { status: number; body: any } = { status: 200, body: null };
    const fakeRes: any = {
      status(code: number) { captured.status = code; return this; },
      json(body: any) { captured.body = body; return this; },
    };
    await payrollAnalysisHandler({ params: { payrollId: id }, __forceLive: true }, fakeRes);

    if (captured.status !== 200 || !Array.isArray(captured.body)) {
      console.error('[LOCK] Could not capture snapshot:', captured);
      return res.status(500).json({ error: 'Could not capture the payroll figures, so the payroll was NOT locked. Please try again.' });
    }

    const snapshot = captured.body as any[];
    const total = snapshot.reduce((sum, r) => sum + (Number(r.net_salary) || 0), 0);

    await client.query('BEGIN');
    try {
      await client.query(
        `INSERT INTO payroll_lock_snapshots (payroll_id, snapshot) VALUES ($1, $2)
         ON CONFLICT (payroll_id) DO UPDATE SET snapshot = EXCLUDED.snapshot, created_at = now()`,
        [id, JSON.stringify(snapshot)]
      );
      await client.query(
        `UPDATE payrolls SET is_locked = true, locked_at = now(), locked_by = $2, total_amount = $3 WHERE id = $1`,
        [id, lockedBy, Math.round(total * 100) / 100]
      );
      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    }

    await writeLockAuditLog('LOCK_PAYROLL', id, { month: existing.rows[0].month, year: existing.rows[0].year, employee_count: snapshot.length, total_amount: total }, lockedBy);
    const after = await client.query('SELECT is_locked, locked_at, locked_by, total_amount FROM payrolls WHERE id = $1', [id]);
    res.json({ success: true, ...after.rows[0] });
  } catch (err) {
    console.error('Error locking payroll:', err);
    res.status(500).json({ error: 'Failed to lock payroll' });
  } finally {
    if (client) client.release();
  }
});

router.post('/payroll/:id/unlock', async (req, res) => {
  const { id } = req.params;
  const unlockedBy: string | null = (req.body && typeof req.body.unlocked_by === 'string' && req.body.unlocked_by.trim()) || null;

  let client: any;
  try {
    await payrollLockSetupPromise;
    client = await payrollPool.connect();

    const existing = await client.query('SELECT id, is_locked, month, year FROM payrolls WHERE id = $1', [id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Payroll not found' });
    if (!existing.rows[0].is_locked) return res.json({ success: true, alreadyUnlocked: true });

    await client.query('BEGIN');
    try {
      await client.query('UPDATE payrolls SET is_locked = false, locked_at = NULL, locked_by = NULL WHERE id = $1', [id]);
      await client.query('DELETE FROM payroll_lock_snapshots WHERE payroll_id = $1', [id]);
      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    }

    await writeLockAuditLog('UNLOCK_PAYROLL', id, { month: existing.rows[0].month, year: existing.rows[0].year }, unlockedBy);
    res.json({ success: true });
  } catch (err) {
    console.error('Error unlocking payroll:', err);
    res.status(500).json({ error: 'Failed to unlock payroll' });
  } finally {
    if (client) client.release();
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
    permission_deduction,
    hourly_short_hours,
    hourly_deduction,
    previous_month_balance
  } = req.body;

  let client;
  try {
    client = await payrollPool.connect();

    if (await isPayrollItemLocked(client, id)) {
      return res.status(423).json({ error: PAYROLL_LOCKED_MESSAGE });
    }

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
    const newPreviousMonthBalance = previous_month_balance !== undefined ? parseFloat(previous_month_balance) : parseFloat(item.previous_month_balance || 0);

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

    // Mid-month joiners were generated with a prorated base salary (calculation_days
    // holds however many days they were actually employed that month). Editing bonus/
    // Sunday work/etc. here must keep using that same shrunk base — otherwise saving
    // any edit on a new joiner's payslip would silently restore their full month's pay.
    const payableDays = parseFloat(item.calculation_days) > 0 ? parseFloat(item.calculation_days) : calendarDays;
    const baseSalaryForPay = dayRate * payableDays;

    const finalLeaveDeduction = leave_deduction !== undefined ? parseFloat(leave_deduction) : parseFloat(item.leave_deduction || '0');
    const tsDeduction = timesheet_deduction !== undefined ? parseFloat(timesheet_deduction) : parseFloat(item.timesheet_deduction || '0');
    const mpDeduction = missing_punch_deduction !== undefined ? parseFloat(missing_punch_deduction) : parseFloat(item.missing_punch_deduction || '0');
    const pfDeduction = parseFloat(item.pf_deduction || '0');
    const esiDeduction = parseFloat(item.esi_deduction || '0');
    const taxDeduction = parseFloat(item.tax_deduction || '0');
    const loanDeduction = parseFloat(item.loan_deduction || '0');

    const sundayEarnings = Math.round(dayRate * newSundayWork * 100) / 100;

    const newPermissionHours = permission_hours !== undefined ? parseFloat(permission_hours) : parseFloat(item.permission_hours || 0);
    const newPermissionDeduction = permission_deduction !== undefined ? parseFloat(permission_deduction) : parseFloat(item.permission_deduction || 0);
    const newHourlyShortHours = hourly_short_hours !== undefined ? parseFloat(hourly_short_hours) : parseFloat(item.hourly_short_hours || 0);
    const newHourlyDeduction = hourly_deduction !== undefined ? parseFloat(hourly_deduction) : parseFloat(item.hourly_deduction || 0);

    const totalDeductions = finalLeaveDeduction + tsDeduction + mpDeduction + pfDeduction + esiDeduction + taxDeduction + loanDeduction + storedAdvance + newPermissionDeduction + newHourlyDeduction;
    const netSalary = Math.max(0, Math.round((baseSalaryForPay - totalDeductions + newBonus + newPreviousMonthBalance + sundayEarnings) * 100) / 100);

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
        missing_punch_deduction = $14,
        hourly_short_hours = $15,
        hourly_deduction = $16,
        previous_month_balance = $17
       WHERE id = $18 RETURNING *`,
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
        newHourlyShortHours,
        newHourlyDeduction,
        newPreviousMonthBalance,
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

// Grant, change, or remove a Timesheet Exception for one payroll item.
// exception_type: 'none' (remove any exception) | 'full' (waive deduction for ALL
// missing timesheet days) | 'partial' (waive deduction for `exception_days` days,
// capped at the employee's current missing day count).
router.patch('/payroll-items/:id/timesheet-exception', async (req, res) => {
  const { id } = req.params;
  const { exception_type, exception_days, note, missing_timesheets } = req.body;

  const validTypes = ['none', 'full', 'partial'];
  const type = validTypes.includes(exception_type) ? exception_type : 'none';

  let client;
  try {
    client = await payrollPool.connect();

    if (await isPayrollItemLocked(client, id)) {
      return res.status(423).json({ error: PAYROLL_LOCKED_MESSAGE });
    }

    const currentRes = await client.query(
      `SELECT pi.*, p.month, p.year
       FROM payroll_items pi
       JOIN payrolls p ON pi.payroll_id = p.id
       WHERE pi.id = $1`,
      [id]
    );
    const item = currentRes.rows[0];
    if (!item) return res.status(404).json({ error: 'Item not found' });

    const monthlySalary = parseFloat(item.monthly_salary) || 0;
    const calendarDays = new Date(parseInt(item.year), parseInt(item.month), 0).getDate();
    const dayRate = calendarDays > 0 ? monthlySalary / calendarDays : 0;

    // Mid-month joiners were generated with a prorated base salary (calculation_days
    // holds however many days they were actually employed). A timesheet exception must
    // keep using that same shrunk base, not the full month's salary.
    const payableDays = parseFloat(item.calculation_days) > 0 ? parseFloat(item.calculation_days) : calendarDays;
    const baseSalaryForPay = dayRate * payableDays;

    // The stored `missing_timesheets` column only reflects the last time
    // "Refresh External Data" was run, and can be stale/out of sync with what's
    // currently shown on screen (which comes from the live analysis endpoint).
    // Trust the value the admin was actually looking at when granting the
    // exception, if the frontend sends it; fall back to the stored value otherwise.
    const missingDaysFromBody = missing_timesheets !== undefined ? parseInt(missing_timesheets) : NaN;
    const missingDays = Number.isFinite(missingDaysFromBody) && missingDaysFromBody >= 0
      ? missingDaysFromBody
      : (Number(item.missing_timesheets) || 0);

    const requestedDays = type === 'partial'
      ? Math.max(0, Math.min(parseFloat(exception_days) || 0, missingDays))
      : 0;

    if (type === 'partial' && requestedDays <= 0) {
      return res.status(400).json({ error: `Enter a valid number of exception days (1 to ${missingDays}).` });
    }

    let exceptionDaysApplied = 0;
    if (type === 'full') exceptionDaysApplied = missingDays;
    else if (type === 'partial') exceptionDaysApplied = requestedDays;

    const payableMissingDays = Math.max(0, missingDays - exceptionDaysApplied);
    const newTsDeduction = Math.round(dayRate * payableMissingDays * 100) / 100;

    // Recompute net salary from the item's other already-stored deductions
    // (mirrors the logic in PATCH /payroll-items/:id).
    const leaveDeduction = parseFloat(item.leave_deduction || '0');
    const missingPunchDeduction = parseFloat(item.missing_punch_deduction || '0');
    const pfDeduction = parseFloat(item.pf_deduction || '0');
    const esiDeduction = parseFloat(item.esi_deduction || '0');
    const taxDeduction = parseFloat(item.tax_deduction || '0');
    const loanDeduction = parseFloat(item.loan_deduction || '0');
    const advanceDeduction = parseFloat(item.advance_deduction || '0');
    const permissionDeduction = parseFloat(item.permission_deduction || '0');
    const hourlyDeduction = parseFloat(item.hourly_deduction || '0');
    const bonus = parseFloat(item.bonus || '0');
    const previousMonthBalance = parseFloat(item.previous_month_balance || '0');
    const sundayWorkDays = parseFloat(item.sunday_work_days || '0');
    const sundayEarnings = Math.round(dayRate * sundayWorkDays * 100) / 100;

    const totalDeductions = leaveDeduction + newTsDeduction + missingPunchDeduction + pfDeduction + esiDeduction + taxDeduction + loanDeduction + advanceDeduction + permissionDeduction + hourlyDeduction;
    const netSalary = Math.max(0, Math.round((baseSalaryForPay - totalDeductions + bonus + previousMonthBalance + sundayEarnings) * 100) / 100);

    const noteValue = typeof note === 'string' && note.trim() ? note.trim() : null;

    const updateRes = await client.query(
      `UPDATE payroll_items SET
        timesheet_exception_type = $1,
        timesheet_exception_days = $2,
        timesheet_exception_note = $3,
        timesheet_exception_granted_at = CASE WHEN $1 = 'none' THEN NULL ELSE now() END,
        timesheet_deduction = $4,
        missing_timesheets = $5,
        net_salary = $6
       WHERE id = $7 RETURNING *`,
      [type, exceptionDaysApplied, noteValue, newTsDeduction, missingDays, netSalary, id]
    );

    await client.query(
      `UPDATE payrolls
       SET total_amount = (SELECT COALESCE(SUM(net_salary), 0) FROM payroll_items WHERE payroll_id = $1)
       WHERE id = $1`,
      [item.payroll_id]

    );

    res.json({ ...updateRes.rows[0], timesheet_exception_days_applied: exceptionDaysApplied });
  } catch (err) {
    console.error('Error setting timesheet exception:', err);
    res.status(500).json({ error: 'Failed to set timesheet exception' });
  } finally {
    if (client) client.release();
  }
});

// Grant, change, or remove a Missing Punch Exception for one payroll item.
// Unlike the timesheet exception (which is all-or-a-count), this is
// per-date: admins check off exactly which missing-punch days should be
// waived from the deduction. `excepted_dates` is the full set of dates that
// should be excepted going forward (send [] to remove the exception
// entirely, or the full missing-dates list to except all of them).
router.patch('/payroll-items/:id/missing-punch-exception', async (req, res) => {
  const { id } = req.params;
  const { excepted_dates, note, missing_punch_dates } = req.body;

  if (excepted_dates !== undefined && !Array.isArray(excepted_dates)) {
    return res.status(400).json({ error: 'excepted_dates must be an array of date strings' });
  }

  let client;
  try {
    client = await payrollPool.connect();

    if (await isPayrollItemLocked(client, id)) {
      return res.status(423).json({ error: PAYROLL_LOCKED_MESSAGE });
    }

    const currentRes = await client.query(
      `SELECT pi.*, p.month, p.year
       FROM payroll_items pi
       JOIN payrolls p ON pi.payroll_id = p.id
       WHERE pi.id = $1`,
      [id]
    );
    const item = currentRes.rows[0];
    if (!item) return res.status(404).json({ error: 'Item not found' });

    const monthlySalary = parseFloat(item.monthly_salary) || 0;
    const calendarDays = new Date(parseInt(item.year), parseInt(item.month), 0).getDate();
    const dayRate = calendarDays > 0 ? monthlySalary / calendarDays : 0;

    const payableDays = parseFloat(item.calculation_days) > 0 ? parseFloat(item.calculation_days) : calendarDays;
    const baseSalaryForPay = dayRate * payableDays;

    // The stored `missing_punch_dates` column only reflects the last time
    // "Refresh External Data" was run. Trust the list the admin was actually
    // looking at when granting the exception, if the frontend sends it; fall
    // back to the stored value otherwise. Only dates that are genuinely in
    // that missing-punch list can be excepted — arbitrary dates are ignored.
    const currentMissingDates: string[] = Array.isArray(missing_punch_dates)
      ? missing_punch_dates
      : (Array.isArray(item.missing_punch_dates) ? item.missing_punch_dates : []);
    const currentMissingSet = new Set(currentMissingDates);

    const requestedExceptedDates: string[] = Array.isArray(excepted_dates) ? excepted_dates : [];
    const validExceptedDates = Array.from(new Set(requestedExceptedDates)).filter((d) => currentMissingSet.has(d));

    const payableMissingPunchDays = Math.max(0, currentMissingDates.length - validExceptedDates.length);
    const newMpDeduction = Math.round(dayRate * payableMissingPunchDays * 100) / 100;

    // Recompute net salary from the item's other already-stored deductions
    // (mirrors the logic in the timesheet-exception endpoint above).
    const leaveDeduction = parseFloat(item.leave_deduction || '0');
    const tsDeduction = parseFloat(item.timesheet_deduction || '0');
    const pfDeduction = parseFloat(item.pf_deduction || '0');
    const esiDeduction = parseFloat(item.esi_deduction || '0');
    const taxDeduction = parseFloat(item.tax_deduction || '0');
    const loanDeduction = parseFloat(item.loan_deduction || '0');
    const advanceDeduction = parseFloat(item.advance_deduction || '0');
    const permissionDeduction = parseFloat(item.permission_deduction || '0');
    const hourlyDeduction = parseFloat(item.hourly_deduction || '0');
    const bonus = parseFloat(item.bonus || '0');
    const previousMonthBalance = parseFloat(item.previous_month_balance || '0');
    const sundayWorkDays = parseFloat(item.sunday_work_days || '0');
    const sundayEarnings = Math.round(dayRate * sundayWorkDays * 100) / 100;

    const totalDeductions = leaveDeduction + tsDeduction + newMpDeduction + pfDeduction + esiDeduction + taxDeduction + loanDeduction + advanceDeduction + permissionDeduction + hourlyDeduction;
    const netSalary = Math.max(0, Math.round((baseSalaryForPay - totalDeductions + bonus + previousMonthBalance + sundayEarnings) * 100) / 100);

    const noteValue = typeof note === 'string' && note.trim() ? note.trim() : null;

    const updateRes = await client.query(
      `UPDATE payroll_items SET
        missing_punch_exception_dates = $1,
        missing_punch_exception_note = $2,
        missing_punch_exception_granted_at = CASE WHEN $3::int = 0 THEN NULL ELSE now() END,
        missing_punch_deduction = $4,
        net_salary = $5
       WHERE id = $6 RETURNING *`,
      [JSON.stringify(validExceptedDates), noteValue, validExceptedDates.length, newMpDeduction, netSalary, id]
    );

    await client.query(
      `UPDATE payrolls
       SET total_amount = (SELECT COALESCE(SUM(net_salary), 0) FROM payroll_items WHERE payroll_id = $1)
       WHERE id = $1`,
      [item.payroll_id]
    );

    res.json({ ...updateRes.rows[0], missing_punch_exception_dates: validExceptedDates });
  } catch (err) {
    console.error('Error setting missing punch exception:', err);
    res.status(500).json({ error: 'Failed to set missing punch exception' });
  } finally {
    if (client) client.release();
  }
});

router.get('/settings', async (_req, res) => {
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

router.post('/attendance/sync-direct', async (_req, res) => {
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
    const empRes = await pClient.query("SELECT id, name, email, department, employee_code FROM employees WHERE status = 'active' ORDER BY name ASC");
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

router.get('/advances', async (_req, res) => {
  let client;
  try {
    client = await payrollPool.connect();
    const result = await client.query(`
      SELECT a.id, a.employee_id, a.amount, a.date, a.reason, a.repayment_type, a.installment_amount,
             a.balance, a.remarks, a.status, a.request_source, a.advance_type, a.no_of_installments,
             a.approved_by, a.approved_at, a.disbursed_at, a.rejected_by, a.rejected_at, a.rejection_reason,
             a.expense_category, a.settlement_type, a.reconciled_amount, a.shortfall_action,
             a.shortfall_reference, a.shortfall_notes, a.carried_forward_to, a.closed_at, a.closed_by,
             a.payment_mode, a.payment_reference, a.attachment_filename,
             (a.attachment_data IS NOT NULL) AS has_attachment,
             a.created_at, a.updated_at,
             e.name as employee_name, e.department
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

// Fetch just the proof-of-payment attachment for one advance (kept out of the list payload above)
router.get('/advances/:id/attachment', async (req, res) => {
  const { id } = req.params;
  let client;
  try {
    client = await payrollPool.connect();
    const result = await client.query('SELECT attachment_filename, attachment_data FROM advances WHERE id = $1', [id]);
    if (result.rows.length === 0 || !result.rows[0].attachment_data) {
      return res.status(404).json({ error: 'No attachment found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching advance attachment:', err);
    res.status(500).json({ error: 'Failed to fetch attachment' });
  } finally {
    if (client) client.release();
  }
});

// ---------------------------------------------------------------------------
// Reconciliation-type advances (Project / Admin expense advances): instead of
// payroll-deducted installments, the employee logs receipted expense line
// items against the advance (Zoho Expense Report style), and the admin
// reconciles + closes it once spend is in.
// ---------------------------------------------------------------------------

router.get('/advances/:id/expense-items', async (req, res) => {
  const { id } = req.params;
  let client;
  try {
    client = await payrollPool.connect();
    const result = await client.query(`
      SELECT id, advance_id, date, category, description, amount, receipt_filename,
             (receipt_data IS NOT NULL) AS has_receipt, created_by, created_at
      FROM advance_expense_items WHERE advance_id = $1 ORDER BY date DESC, created_at DESC
    `, [id]);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching expense items:', err);
    res.status(500).json({ error: 'Failed to fetch expense items' });
  } finally {
    if (client) client.release();
  }
});

router.get('/advances/:id/expense-items/:itemId/receipt', async (req, res) => {
  const { itemId } = req.params;
  let client;
  try {
    client = await payrollPool.connect();
    const result = await client.query('SELECT receipt_filename, receipt_data FROM advance_expense_items WHERE id = $1', [itemId]);
    if (result.rows.length === 0 || !result.rows[0].receipt_data) {
      return res.status(404).json({ error: 'No receipt found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching receipt:', err);
    res.status(500).json({ error: 'Failed to fetch receipt' });
  } finally {
    if (client) client.release();
  }
});

router.post('/advances/:id/expense-items', async (req, res) => {
  const { id } = req.params;
  const { date, category, description, amount, receipt_filename, receipt_data, created_by } = req.body;
  if (!date || !category || !amount) {
    return res.status(400).json({ error: 'Date, category and amount are required' });
  }
  let client;
  try {
    client = await payrollPool.connect();
    const advRes = await client.query('SELECT id, settlement_type, status FROM advances WHERE id = $1', [id]);
    if (advRes.rows.length === 0) return res.status(404).json({ error: 'Advance not found' });
    if (advRes.rows[0].settlement_type !== 'Reconciliation') {
      return res.status(400).json({ error: 'Expense items can only be logged against a Reconciliation-type advance' });
    }
    if (advRes.rows[0].status === 'Closed') {
      return res.status(400).json({ error: 'This advance is already closed' });
    }

    const parsedAmount = parseFloat(amount.toString()) || 0;
    const itemRes = await client.query(`
      INSERT INTO advance_expense_items (advance_id, date, category, description, amount, receipt_filename, receipt_data, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id, advance_id, date, category, description, amount, receipt_filename,
                (receipt_data IS NOT NULL) AS has_receipt, created_by, created_at
    `, [id, date, category, description || null, parsedAmount, receipt_filename || null, receipt_data || null, created_by || null]);

    await client.query(
      `UPDATE advances SET reconciled_amount = COALESCE(reconciled_amount, 0) + $1 WHERE id = $2`,
      [parsedAmount, id]
    );

    res.status(201).json(itemRes.rows[0]);
  } catch (err) {
    console.error('Error adding expense item:', err);
    res.status(500).json({ error: 'Failed to add expense item' });
  } finally {
    if (client) client.release();
  }
});

router.delete('/advances/:id/expense-items/:itemId', async (req, res) => {
  const { id, itemId } = req.params;
  let client;
  try {
    client = await payrollPool.connect();
    const itemRes = await client.query('SELECT amount FROM advance_expense_items WHERE id = $1 AND advance_id = $2', [itemId, id]);
    if (itemRes.rows.length === 0) return res.status(404).json({ error: 'Expense item not found' });

    await client.query('DELETE FROM advance_expense_items WHERE id = $1', [itemId]);
    await client.query(
      `UPDATE advances SET reconciled_amount = GREATEST(0, COALESCE(reconciled_amount, 0) - $1) WHERE id = $2`,
      [Number(itemRes.rows[0].amount), id]
    );
    res.status(204).send();
  } catch (err) {
    console.error('Error deleting expense item:', err);
    res.status(500).json({ error: 'Failed to delete expense item' });
  } finally {
    if (client) client.release();
  }
});

// Reconcile & close a Reconciliation-type advance against what's been logged so far.
// Mirrors Zoho Expense's report settlement: if the employee under-spent the advance,
// the gap is either Refunded (money returned) or Carried Forward (rolled into a new
// advance for next time); if they over-spent, the excess is flagged Reimbursed.
router.post('/advances/:id/reconcile', async (req, res) => {
  const { id } = req.params;
  const { action, reference, notes, closed_by } = req.body;
  let client;
  try {
    client = await payrollPool.connect();
    const currentRes = await client.query('SELECT * FROM advances WHERE id = $1', [id]);
    if (currentRes.rows.length === 0) return res.status(404).json({ error: 'Advance not found' });
    const current = currentRes.rows[0];

    if (current.settlement_type !== 'Reconciliation') {
      return res.status(400).json({ error: 'Only Reconciliation-type advances are closed this way — payroll advances close automatically once the balance is recovered' });
    }
    if (current.status !== 'Active') {
      return res.status(400).json({ error: 'Only an Active advance can be reconciled' });
    }

    const advanceAmount = Number(current.amount);
    const reconciled = Number(current.reconciled_amount) || 0;
    const gap = Math.round((advanceAmount - reconciled) * 100) / 100; // >0 = employee owes company, <0 = company owes employee

    const allowedActions = ['Refunded', 'Carried Forward', 'Reimbursed', 'Settled'];
    if (!action || !allowedActions.includes(action)) {
      return res.status(400).json({ error: `action must be one of: ${allowedActions.join(', ')}` });
    }
    if (gap > 0.01 && action === 'Reimbursed') {
      return res.status(400).json({ error: 'Reimbursed only applies when spend exceeds the advance amount' });
    }
    if (gap < -0.01 && (action === 'Refunded' || action === 'Carried Forward')) {
      return res.status(400).json({ error: 'Refunded / Carried Forward only apply when the employee under-spent the advance' });
    }

    let carriedForwardId: string | null = null;

    if (action === 'Carried Forward' && gap > 0.01) {
      const newAdvRes = await client.query(`
        INSERT INTO advances (
          employee_id, amount, date, reason, repayment_type, installment_amount, balance, remarks, status,
          expense_category, settlement_type
        )
        VALUES ($1, $2, CURRENT_DATE, $3, 'One-time', $2, $2, $4, 'Active', $5, 'Reconciliation')
        RETURNING id
      `, [
        current.employee_id,
        gap,
        `Carried forward from advance dated ${new Date(current.date).toISOString().slice(0, 10)}`,
        notes || null,
        current.expense_category
      ]);
      carriedForwardId = newAdvRes.rows[0].id;
    }

    const result = await client.query(`
      UPDATE advances
      SET status = 'Closed',
          balance = 0,
          shortfall_action = $1,
          shortfall_reference = $2,
          shortfall_notes = $3,
          carried_forward_to = $4,
          closed_at = NOW(),
          closed_by = $5
      WHERE id = $6
      RETURNING id, employee_id, amount, reconciled_amount, status, shortfall_action, shortfall_reference,
                shortfall_notes, carried_forward_to, closed_at, closed_by
    `, [action, reference || null, notes || null, carriedForwardId, closed_by || 'admin@company.com', id]);

    await client.query(
      `INSERT INTO audit_logs (action, entity, entity_id, details, user_email) VALUES ($1,$2,$3,$4,$5)`,
      ['ADVANCE_RECONCILED', 'advances', id, JSON.stringify({ employee_id: current.employee_id, advanceAmount, reconciled, gap, action, carriedForwardId }), closed_by || 'admin@company.com']
    );

    res.json({ ...result.rows[0], gap, carried_forward_id: carriedForwardId });
  } catch (err) {
    console.error('Error reconciling advance:', err);
    res.status(500).json({ error: 'Failed to reconcile advance' });
  } finally {
    if (client) client.release();
  }
});

// Manual close / write-off for a Payroll-type advance that's stuck Active
// (e.g. an old advance whose payroll was never marked paid, or a balance the
// company has decided to waive). Reconciliation-type advances have their own
// dedicated close flow (/reconcile) and are not allowed through this route.
router.post('/advances/:id/manual-close', async (req, res) => {
  const { id } = req.params;
  const { closed_by, reason } = req.body;

  if (!reason || !reason.trim()) {
    return res.status(400).json({ error: 'A reason is required to manually close an advance' });
  }

  let client;
  try {
    client = await payrollPool.connect();
    const currentRes = await client.query('SELECT * FROM advances WHERE id = $1', [id]);
    if (currentRes.rows.length === 0) return res.status(404).json({ error: 'Advance not found' });
    const current = currentRes.rows[0];

    if (current.status !== 'Active') {
      return res.status(400).json({ error: 'Only an Active advance can be manually closed' });
    }
    if (current.settlement_type === 'Reconciliation') {
      return res.status(400).json({ error: 'Reconciliation advances are closed via Reconcile & Close, not this action' });
    }

    const writtenOffAmount = Number(current.balance) || 0;

    const result = await client.query(`
      UPDATE advances
      SET status = 'Closed',
          balance = 0,
          shortfall_action = 'Written Off',
          shortfall_notes = $1,
          closed_at = NOW(),
          closed_by = $2
      WHERE id = $3
      RETURNING id, employee_id, amount, balance, status, shortfall_action, shortfall_notes, closed_at, closed_by
    `, [reason.trim(), closed_by || 'admin@company.com', id]);

    await client.query(
      `INSERT INTO audit_logs (action, entity, entity_id, details, user_email) VALUES ($1,$2,$3,$4,$5)`,
      ['ADVANCE_MANUALLY_CLOSED', 'advances', id, JSON.stringify({ employee_id: current.employee_id, writtenOffAmount, reason: reason.trim() }), closed_by || 'admin@company.com']
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error manually closing advance:', err);
    res.status(500).json({ error: 'Failed to manually close advance' });
  } finally {
    if (client) client.release();
  }
});

router.post('/advances', async (req, res) => {
  const {
    employee_id, amount, date, reason, repayment_type, installment_amount, remarks,
    expense_category, settlement_type, payment_mode, payment_reference, attachment_filename, attachment_data
  } = req.body;

  // Direct admin entries represent an advance that has already been paid out,
  // so we require proof of disbursement (payment mode + attachment) up front.
  if (!payment_mode) {
    return res.status(400).json({ error: 'Payment mode (UPI / Cheque / Bank Transfer / Cash) is required' });
  }
  if (!attachment_data) {
    return res.status(400).json({ error: 'Proof of payment attachment is required' });
  }

  let client;
  try {
    client = await payrollPool.connect();
    const result = await client.query(`
      INSERT INTO advances (
        employee_id, amount, date, reason, repayment_type, installment_amount, balance, remarks, status,
        expense_category, settlement_type, payment_mode, payment_reference, attachment_filename, attachment_data,
        disbursed_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Active', $9, $10, $11, $12, $13, $14, NOW())
      RETURNING id, employee_id, amount, date, reason, repayment_type, installment_amount, balance, remarks,
                status, expense_category, settlement_type, payment_mode, payment_reference, attachment_filename,
                (attachment_data IS NOT NULL) AS has_attachment, disbursed_at, created_at, updated_at
    `, [
      employee_id,
      parseFloat(amount.toString()) || 0,
      date,
      reason,
      repayment_type,
      parseFloat((installment_amount || '0').toString()) || 0,
      parseFloat(amount.toString()) || 0,
      remarks,
      expense_category || 'Salary',
      settlement_type || (expense_category === 'Salary' || !expense_category ? 'Payroll' : 'Reconciliation'),
      payment_mode,
      payment_reference || null,
      attachment_filename || null,
      attachment_data
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
  const {
    amount, date, reason, repayment_type, installment_amount, remarks,
    expense_category, settlement_type, payment_mode, payment_reference, attachment_filename, attachment_data
  } = req.body;
  let client;
  try {
    client = await payrollPool.connect();
    // Re-calculate balance if amount changes (simple calculation assuming no deductions have been made yet, or preserving recovered amount difference)
    const currentRes = await client.query('SELECT amount, balance, attachment_data, attachment_filename FROM advances WHERE id = $1', [id]);
    if (currentRes.rows.length === 0) return res.status(404).json({ error: 'Advance not found' });
    const current = currentRes.rows[0];
    const recovered = Number(current.amount) - Number(current.balance);
    const newAmount = parseFloat(amount.toString()) || 0;
    const newBalance = Math.max(0, newAmount - recovered);

    // Only overwrite the stored attachment if a new one was actually uploaded,
    // so editing other fields doesn't wipe out the existing proof of payment.
    const newAttachmentData = attachment_data !== undefined ? attachment_data : current.attachment_data;
    const newAttachmentFilename = attachment_data !== undefined ? (attachment_filename || null) : current.attachment_filename;

    const result = await client.query(`
      UPDATE advances
      SET amount = $1, date = $2, reason = $3, repayment_type = $4, installment_amount = $5, balance = $6, remarks = $7,
          expense_category = COALESCE($8, expense_category), settlement_type = COALESCE($9, settlement_type),
          payment_mode = COALESCE($10, payment_mode),
          payment_reference = COALESCE($11, payment_reference), attachment_filename = $12, attachment_data = $13
      WHERE id = $14
      RETURNING id, employee_id, amount, date, reason, repayment_type, installment_amount, balance, remarks,
                status, expense_category, settlement_type, payment_mode, payment_reference, attachment_filename,
                (attachment_data IS NOT NULL) AS has_attachment, disbursed_at, created_at, updated_at
    `, [
      newAmount,
      date,
      reason,
      repayment_type,
      parseFloat((installment_amount || '0').toString()) || 0,
      newBalance,
      remarks,
      expense_category || null,
      settlement_type || null,
      payment_mode || null,
      payment_reference !== undefined ? payment_reference : null,
      newAttachmentFilename,
      newAttachmentData,
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

// ---------------------------------------------------------------------------
// Advance request workflow (Zoho-style "employee raises -> admin approves")
// This sits alongside the existing direct-create/edit/delete routes above and
// does not alter their behaviour. Requests start life as 'Pending Approval'
// and only become a real 'Active' advance (i.e. picked up by payroll) once
// approved.
// ---------------------------------------------------------------------------

// Employee raises a new advance request
router.post('/advances/request', async (req, res) => {
  const { employee_id, amount, date, reason, advance_type, repayment_type, no_of_installments, remarks } = req.body;
  if (!employee_id || !amount) {
    return res.status(400).json({ error: 'Employee and amount are required' });
  }
  let client;
  try {
    client = await payrollPool.connect();
    const parsedAmount = parseFloat(amount.toString()) || 0;
    const installments = repayment_type === 'One-time' ? 1 : (parseInt((no_of_installments || '1').toString(), 10) || 1);
    const installmentAmount = repayment_type === 'One-time' ? parsedAmount : Math.ceil((parsedAmount / installments) * 100) / 100;

    const result = await client.query(`
      INSERT INTO advances (
        employee_id, amount, date, reason, repayment_type, installment_amount, balance, remarks,
        status, request_source, advance_type, no_of_installments
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Pending Approval', 'Employee Request', $9, $10)
      RETURNING *
    `, [
      employee_id,
      parsedAmount,
      date || new Date().toISOString().slice(0, 10),
      reason,
      repayment_type || 'Monthly',
      installmentAmount,
      parsedAmount,
      remarks,
      advance_type || 'Salary Advance',
      installments
    ]);

    const advance = result.rows[0];
    await client.query(
      `INSERT INTO audit_logs (action, entity, entity_id, details, user_email) VALUES ($1,$2,$3,$4,$5)`,
      ['ADVANCE_REQUEST_RAISED', 'advances', advance.id, JSON.stringify({ employee_id, amount: parsedAmount, advance_type }), 'employee-self-service']
    );

    res.status(201).json(advance);
  } catch (err) {
    console.error('Error raising advance request:', err);
    res.status(500).json({ error: 'Failed to raise advance request' });
  } finally {
    if (client) client.release();
  }
});

// Admin/approver approves a pending request -> becomes an Active advance
router.post('/advances/:id/approve', async (req, res) => {
  const { id } = req.params;
  const {
    approved_by, installment_amount,
    expense_category, settlement_type, payment_mode, payment_reference, attachment_filename, attachment_data
  } = req.body;

  // Approving a request is the actual disbursement moment for employee-raised
  // advances, so proof of payment is required here too.
  if (!payment_mode) {
    return res.status(400).json({ error: 'Payment mode (UPI / Cheque / Bank Transfer / Cash) is required to approve & disburse' });
  }
  if (!attachment_data) {
    return res.status(400).json({ error: 'Proof of payment attachment is required to approve & disburse' });
  }

  let client;
  try {
    client = await payrollPool.connect();
    const currentRes = await client.query('SELECT * FROM advances WHERE id = $1', [id]);
    if (currentRes.rows.length === 0) return res.status(404).json({ error: 'Advance request not found' });
    const current = currentRes.rows[0];

    const finalInstallmentAmount = installment_amount
      ? (parseFloat(installment_amount.toString()) || Number(current.installment_amount))
      : Number(current.installment_amount);

    const finalExpenseCategory = expense_category || current.expense_category || 'Salary';
    const finalSettlementType = settlement_type || (finalExpenseCategory === 'Salary' ? 'Payroll' : 'Reconciliation');

    const result = await client.query(`
      UPDATE advances
      SET status = 'Active',
          approved_by = $1,
          approved_at = NOW(),
          disbursed_at = NOW(),
          installment_amount = $2,
          expense_category = $3,
          settlement_type = $4,
          payment_mode = $5,
          payment_reference = $6,
          attachment_filename = $7,
          attachment_data = $8
      WHERE id = $9
      RETURNING id, employee_id, amount, date, reason, repayment_type, installment_amount, balance, remarks,
                status, expense_category, settlement_type, payment_mode, payment_reference, attachment_filename,
                (attachment_data IS NOT NULL) AS has_attachment, approved_by, approved_at, disbursed_at
    `, [
      approved_by || 'admin@company.com',
      finalInstallmentAmount,
      finalExpenseCategory,
      finalSettlementType,
      payment_mode,
      payment_reference || null,
      attachment_filename || null,
      attachment_data,
      id
    ]);

    await client.query(
      `INSERT INTO audit_logs (action, entity, entity_id, details, user_email) VALUES ($1,$2,$3,$4,$5)`,
      ['ADVANCE_REQUEST_APPROVED', 'advances', id, JSON.stringify({ employee_id: current.employee_id, amount: current.amount, payment_mode, expense_category: finalExpenseCategory, settlement_type: finalSettlementType }), approved_by || 'admin@company.com']
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error approving advance request:', err);
    res.status(500).json({ error: 'Failed to approve advance request' });
  } finally {
    if (client) client.release();
  }
});

// Admin/approver rejects a pending request
router.post('/advances/:id/reject', async (req, res) => {
  const { id } = req.params;
  const { rejected_by, rejection_reason } = req.body;
  let client;
  try {
    client = await payrollPool.connect();
    const currentRes = await client.query('SELECT * FROM advances WHERE id = $1', [id]);
    if (currentRes.rows.length === 0) return res.status(404).json({ error: 'Advance request not found' });
    const current = currentRes.rows[0];

    const result = await client.query(`
      UPDATE advances
      SET status = 'Rejected',
          rejected_by = $1,
          rejected_at = NOW(),
          rejection_reason = $2,
          balance = 0
      WHERE id = $3
      RETURNING *
    `, [rejected_by || 'admin@company.com', rejection_reason || null, id]);

    await client.query(
      `INSERT INTO audit_logs (action, entity, entity_id, details, user_email) VALUES ($1,$2,$3,$4,$5)`,
      ['ADVANCE_REQUEST_REJECTED', 'advances', id, JSON.stringify({ employee_id: current.employee_id, amount: current.amount, rejection_reason }), rejected_by || 'admin@company.com']
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error rejecting advance request:', err);
    res.status(500).json({ error: 'Failed to reject advance request' });
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