/**
 * Auto-Generate Payroll (additive feature)
 *
 * Generates the PREVIOUS month's payroll automatically on a configured day of
 * each month. It deliberately reuses the existing payroll engine:
 *   - computePayrollPreviewData()  → same attendance / leave / overtime-hours / holiday data
 *                                    the manual "Preview & Validate" step uses
 *   - calculatePayroll()           → same salary / PF / ESI / tax / advance / hourly maths
 *   - getSalaryBreakdown()         → same HRA / conveyance / medical split
 * The per-employee mapping below mirrors `generatePayroll()` in src/pages/Payroll.tsx
 * (default "monthly" calculation mode, as in the manual Configure dialog).
 *
 * Safety:
 *   - auto_payroll_runs has a (month, year) primary key → atomic claim, no duplicates,
 *     even with two server instances or overlapping ticks.
 *   - If ANY payroll already exists for that month (manual or auto) it is left untouched.
 *   - Whole payroll (payroll + items + payslips) is written in ONE transaction.
 *   - Missed schedules (server down on the day) are caught up on the next tick, but only
 *     for the current cycle and only if the feature was enabled before that scheduled date.
 *   - Failed runs retry (max 3 attempts); stuck "running" claims expire after 30 min.
 */
import cron from 'node-cron';
import { payrollPool, computePayrollPreviewData, getEligibleDaysForMonthServer } from '../routes/payrollRoutes';
import { calculateHourlyExcessDeduction, calculatePayroll } from '../lib/payrollCalculator';
import { getSalaryBreakdown } from '../lib/salaryBreakdown';

const KEY_ENABLED = 'auto_payroll_enabled';
const KEY_DAY = 'auto_payroll_day';
const KEY_ENABLED_AT = 'auto_payroll_enabled_at';
const MAX_ATTEMPTS = 3;

export interface AutoPayrollConfig {
  enabled: boolean;
  day: number;
  enabledAt: string | null;
}

// ─── Date helpers (always India time, independent of process TZ) ─────────────
function istToday(now = new Date()): { year: number; month: number; day: number; iso: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now).split('-').map(Number);
  const [year, month, day] = parts;
  return { year, month, day, iso: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` };
}

const daysInMonth = (month: number, year: number) => new Date(year, month, 0).getDate();

/** Configured day clamped to the month length (31 → 28/29/30 in short months). */
export function effectiveDay(configuredDay: number, month: number, year: number) {
  return Math.min(Math.max(1, configuredDay), daysInMonth(month, year));
}

export function previousMonthOf(month: number, year: number) {
  return month === 1 ? { month: 12, year: year - 1 } : { month: month - 1, year };
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// ─── Persistence ─────────────────────────────────────────────────────────────
let tableReady = false;
export async function ensureAutoPayrollTable() {
  if (tableReady) return;
  await payrollPool.query(`
    CREATE TABLE IF NOT EXISTS auto_payroll_runs (
      month integer NOT NULL CHECK (month BETWEEN 1 AND 12),
      year integer NOT NULL,
      status text NOT NULL DEFAULT 'running',
      attempts integer NOT NULL DEFAULT 1,
      payroll_id uuid,
      message text,
      started_at timestamptz DEFAULT now(),
      finished_at timestamptz,
      PRIMARY KEY (month, year)
    )`);
  tableReady = true;
}

export async function getAutoPayrollConfig(): Promise<AutoPayrollConfig> {
  const r = await payrollPool.query(`SELECT key, value FROM settings WHERE key = ANY($1)`, [[KEY_ENABLED, KEY_DAY, KEY_ENABLED_AT]]);
  const map: Record<string, string> = {};
  r.rows.forEach((row: any) => { map[row.key] = row.value || ''; });
  const day = parseInt(map[KEY_DAY] || '2', 10);
  return {
    enabled: map[KEY_ENABLED] === 'true',
    day: Number.isFinite(day) && day >= 1 && day <= 31 ? day : 2,
    enabledAt: map[KEY_ENABLED_AT] || null,
  };
}

async function upsertSetting(key: string, value: string) {
  await payrollPool.query(
    `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [key, value]
  );
}

export async function saveAutoPayrollConfig(input: { enabled: boolean; day: number }, userEmail?: string | null) {
  const prev = await getAutoPayrollConfig();
  const day = Math.floor(Number(input.day));
  if (!Number.isFinite(day) || day < 1 || day > 31) throw new Error('Day must be between 1 and 31');

  await upsertSetting(KEY_ENABLED, input.enabled ? 'true' : 'false');
  await upsertSetting(KEY_DAY, String(day));
  // Re-arm from today when switched ON or when the day changes while ON, so turning the
  // feature on (e.g. on the 20th with day=2) never back-fires an immediate catch-up run.
  if (input.enabled && (!prev.enabled || prev.day !== day)) {
    await upsertSetting(KEY_ENABLED_AT, istToday().iso);
  }
  try {
    await payrollPool.query(
      `INSERT INTO audit_logs (action, entity, details, user_email) VALUES ('UPDATE_AUTO_PAYROLL_SETTINGS', 'settings', $1, COALESCE($2, 'admin@company.com'))`,
      [JSON.stringify({ enabled: input.enabled, day }), userEmail || null]
    );
  } catch { /* audit is best-effort */ }
  return getAutoPayrollConfig();
}

export async function getAutoPayrollStatus() {
  await ensureAutoPayrollTable();
  const config = await getAutoPayrollConfig();
  const today = istToday();
  let nextRun: { date: string; payrollMonth: number; payrollYear: number } | null = null;
  if (config.enabled) {
    let m = today.month, y = today.year;
    let d = effectiveDay(config.day, m, y);
    // Next run = this month's date if still ahead (or not yet run), else next month's
    const thisCycleTarget = previousMonthOf(m, y);
    const done = await payrollPool.query(
      `SELECT 1 FROM auto_payroll_runs WHERE month=$1 AND year=$2 AND status IN ('completed','skipped')`,
      [thisCycleTarget.month, thisCycleTarget.year]
    );
    const thisCycleDate = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (thisCycleDate < today.iso || (thisCycleDate === today.iso && done.rows.length > 0)) {
      m = m === 12 ? 1 : m + 1; y = m === 1 ? y + 1 : y; d = effectiveDay(config.day, m, y);
    }
    const t = previousMonthOf(m, y);
    nextRun = { date: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, payrollMonth: t.month, payrollYear: t.year };
  }
  const runs = await payrollPool.query(
    `SELECT month, year, status, attempts, payroll_id, message, started_at, finished_at
       FROM auto_payroll_runs ORDER BY year DESC, month DESC LIMIT 6`
  );
  return { config, nextRun, recentRuns: runs.rows };
}

// ─── Generation (mirrors Payroll.tsx generatePayroll) ────────────────────────
const countSundays = (month: number, year: number) => {
  let sundays = 0;
  for (let day = 1; day <= daysInMonth(month, year); day++) {
    if (new Date(year, month - 1, day).getDay() === 0) sundays++;
  }
  return sundays;
};

async function bestEffortTimesheetSync() {
  // The Payroll page syncs employees from the timesheet system before generating; do the same.
  try {
    const port = process.env.PORT ? Number(process.env.PORT) : 5002;
    await fetch(`http://127.0.0.1:${port}/api/employees/sync-timesheet`, { method: 'POST' });
  } catch (e) {
    console.warn('[AUTO-PAYROLL] Employee sync skipped:', e instanceof Error ? e.message : e);
  }
}

async function generatePayrollForMonth(month: number, year: number): Promise<{ payrollId: string; employeeCount: number; totalAmount: number }> {
  await bestEffortTimesheetSync();

  const empRes = await payrollPool.query(`SELECT id FROM employees WHERE status = 'active' ORDER BY name`);
  const employeeIds: string[] = empRes.rows.map((r: any) => r.id);
  if (employeeIds.length === 0) throw new Error('No active employees');

  const dataToUse: any = await computePayrollPreviewData(employeeIds, month, year);
  if (!dataToUse?.employees?.length) throw new Error('Preview returned no employees');

  const sRes = await payrollPool.query('SELECT key, value FROM settings');
  const settings: Record<string, string> = Object.fromEntries(sRes.rows.map((s: any) => [s.key, s.value || '']));
  const pfRate = parseFloat(settings.pf_rate || '12');
  const esiRate = parseFloat(settings.esi_rate || '0.75');
  const esiLimit = parseFloat(settings.esi_limit || '21000');
  const taxRate = parseFloat(settings.tax_rate || '10');
  const workingDays = parseInt(settings.working_days || '26');
  const calculationType: 'monthly' | 'custom' | 'working_days' = 'monthly'; // manual dialog default

  const advRes = await payrollPool.query(
    `SELECT employee_id, installment_amount, balance, status, repayment_type FROM advances WHERE status = 'Active' AND balance > 0`
  );
  const advanceByEmp = new Map<string, number>();
  advRes.rows.forEach((adv: any) => {
    const inst = parseFloat(adv.installment_amount || 0);
    const bal = parseFloat(adv.balance || 0);
    const deduction = (adv.repayment_type === 'One-time' || inst === 0) ? bal : Math.min(inst, bal);
    if (deduction > 0) advanceByEmp.set(adv.employee_id, (advanceByEmp.get(adv.employee_id) || 0) + deduction);
  });

  const calendarDays = daysInMonth(month, year);
  let totalAmount = 0;
  const items: any[] = [];

  for (const emp of dataToUse.employees) {
    const monthlySalary = emp.ctc / 12;
    const salaryBreakdown = getSalaryBreakdown(monthlySalary);
    let effectiveWorkingDays = workingDays;
    if ((calculationType as string) === 'working_days') {
      effectiveWorkingDays = calendarDays - countSundays(month, year);
    }
    const advanceDeduction = advanceByEmp.get(emp.id) || 0;
    const eligibleDays = getEligibleDaysForMonthServer(emp.joining_date, month, year, calendarDays, emp.relieving_date);
    const isMidMonthJoiner = eligibleDays < calendarDays;

    const totalUnpaid = emp.summary.unpaidDays || 0;
    const punchMissing = emp.summary.punchMissing || 0;
    const leaveLinkedSandwichSundays = (emp.days || []).reduce((count: number, day: any, i: number, all: any[]) => {
      if (!day?.sunday_sandwich || i === 0 || i >= all.length - 1) return count;
      const hasLeave = (d: any) => !!d && d.leave_type && d.leave_type !== '-';
      return (hasLeave(all[i - 1]) || hasLeave(all[i + 1])) ? count + 1 : count;
    }, 0);
    const sundayDeductions = Math.max(0, (emp.summary.sundayDeductions || 0) - leaveLinkedSandwichSundays);
    const lessThan9 = emp.summary.lessThan9 || 0;
    const nonLeaveDeductions = punchMissing + sundayDeductions + lessThan9;
    const unpaidLeaves = Math.max(0, totalUnpaid - nonLeaveDeductions);
    const missingTimesheets = 0;
    const effectiveMissingPunches = punchMissing + lessThan9;
    const hourlyDeductionBreakdown = calculateHourlyExcessDeduction(
      emp.summary.deductibleShortfallHours || 0,
      monthlySalary / calendarDays
    );
    const hourlyDeductionAmount = hourlyDeductionBreakdown.totalDeduction;

    const calc = calculatePayroll({
      monthlySalary,
      workingDays: effectiveWorkingDays,
      calendarDays,
      unpaidLeaves,
      missingTimesheets,
      missingPunches: effectiveMissingPunches,
      bonus: 0,
      pfRate, esiRate, esiLimit, taxRate,
      loanDeduction: 0,
      advanceDeduction,
      sundayWorkDays: 0,
      calculationType: isMidMonthJoiner ? 'custom' : calculationType,
      customDays: isMidMonthJoiner ? eligibleDays : 0,
      sundayDeductions,
      hourlyDeductionAmount,
    });

    totalAmount += calc.netSalary;
    items.push({
      employee_id: emp.id,
      monthly_salary: calc.monthlySalary,
      hra: salaryBreakdown.hra,
      conveyance: salaryBreakdown.conveyance,
      medical: salaryBreakdown.medical,
      leave_deduction: calc.leaveDeduction,
      timesheet_deduction: calc.timesheetDeduction,
      missing_punches: effectiveMissingPunches,
      missing_punch_deduction: calc.missingPunchDeduction,
      pf_deduction: calc.pfDeduction,
      esi_deduction: calc.esiDeduction,
      tax_deduction: calc.taxDeduction,
      loan_deduction: calc.loanDeduction,
      advance_deduction: calc.advanceDeduction,
      sunday_work_days: 0,
      bonus: calc.bonus,
      net_salary: calc.netSalary,
      unpaid_leaves: unpaidLeaves,
      missing_timesheets: missingTimesheets,
      holiday_count: 0,
      pa_sla_consumed: emp.summary.paSlaConsumed || 0,
      timesheet_excluded_dates: [],
      holiday_dates: [],
      working_days: isMidMonthJoiner ? eligibleDays : calendarDays,
      calculation_type: isMidMonthJoiner ? 'custom' : calculationType,
      calculation_days: isMidMonthJoiner ? eligibleDays : calendarDays,
      permission_hours: emp.summary.approvedPermissionHours || 0,
      permission_deduction: calc.permissionDeduction,
      hourly_short_hours: emp.summary.deductibleShortfallHours || 0,
      hourly_deduction: calc.hourlyDeductionAmount,
      hourly_deduction_breakdown: hourlyDeductionBreakdown,
    });
  }

  const client = await payrollPool.connect();
  try {
    await client.query('BEGIN');
    // Re-check inside the transaction: never create a second payroll for the month.
    await client.query('SELECT pg_advisory_xact_lock($1)', [year * 100 + month]);
    const exists = await client.query('SELECT 1 FROM payrolls WHERE month=$1 AND year=$2 LIMIT 1', [month, year]);
    if (exists.rows.length > 0) throw new Error('ALREADY_EXISTS');

    const pr = await client.query(
      `INSERT INTO payrolls (month, year, status, employee_count, total_amount, generated_at, version, regeneration_reason)
       VALUES ($1,$2,'completed',$3,$4,NOW(),1,NULL) RETURNING id`,
      [month, year, items.length, totalAmount]
    );
    const payrollId: string = pr.rows[0].id;

    for (const it of items) {
      const cols = ['payroll_id', ...Object.keys(it)];
      // timesheet_excluded_dates / holiday_dates are JSONB columns → must be sent as JSON text
      const vals = [payrollId, ...Object.entries(it).map(([k, v]) =>
        (k === 'timesheet_excluded_dates' || k === 'holiday_dates' || k === 'hourly_deduction_breakdown') ? JSON.stringify(v) : v)];
      const ph = cols.map((_, i) => `$${i + 1}`).join(',');
      const ins = await client.query(`INSERT INTO payroll_items (${cols.join(',')}) VALUES (${ph}) RETURNING id, employee_id`, vals);
      await client.query(
        `INSERT INTO payslips (payroll_id, employee_id, payroll_item_id, status) VALUES ($1,$2,$3,'generated')`,
        [payrollId, ins.rows[0].employee_id, ins.rows[0].id]
      );
    }

    await client.query(
      `INSERT INTO audit_logs (action, entity, entity_id, details, user_email) VALUES ('GENERATE_PAYROLL','payrolls',$1,$2,'auto-payroll@system')`,
      [payrollId, JSON.stringify({ month, year, employee_count: items.length, total_amount: totalAmount, version: 1, regeneration_reason: null, automatic: true })]
    );
    await client.query('COMMIT');
    return { payrollId, employeeCount: items.length, totalAmount };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// ─── Runner ──────────────────────────────────────────────────────────────────
let ticking = false;

/**
 * Evaluate the schedule and, if due, generate last month's payroll.
 * `force` (manual "Run now" from Settings) ignores the date/enabled-at checks
 * but still honours the duplicate guard.
 */
export async function runAutoPayrollCheck(opts: { force?: boolean } = {}) {
  if (ticking) return { status: 'busy' as const };
  ticking = true;
  try {
    await ensureAutoPayrollTable();
    const config = await getAutoPayrollConfig();
    if (!config.enabled && !opts.force) return { status: 'disabled' as const };

    const today = istToday();
    const target = previousMonthOf(today.month, today.year);
    const scheduled = effectiveDay(config.day, today.month, today.year);
    const scheduledIso = `${today.year}-${String(today.month).padStart(2, '0')}-${String(scheduled).padStart(2, '0')}`;

    if (!opts.force) {
      if (today.day < scheduled) return { status: 'not_due' as const };
      // Enabled/changed after this cycle's date → wait for the next cycle (no surprise run).
      if (config.enabledAt && scheduledIso < config.enabledAt) return { status: 'not_due' as const };
    }

    // Atomic claim: only one runner can own (month, year).
    const claim = await payrollPool.query(
      `INSERT INTO auto_payroll_runs (month, year, status, attempts, started_at)
       VALUES ($1,$2,'running',1,NOW())
       ON CONFLICT (month, year) DO UPDATE
         SET status='running', attempts = auto_payroll_runs.attempts + 1, started_at = NOW(), finished_at = NULL
         WHERE (auto_payroll_runs.status = 'failed' AND auto_payroll_runs.attempts < $3)
            OR (auto_payroll_runs.status = 'running' AND auto_payroll_runs.started_at < NOW() - INTERVAL '30 minutes')
       RETURNING attempts`,
      [target.month, target.year, MAX_ATTEMPTS]
    );
    if (claim.rows.length === 0) return { status: 'already_handled' as const, month: target.month, year: target.year };

    const label = `${MONTHS[target.month - 1]} ${target.year}`;
    try {
      const existing = await payrollPool.query('SELECT id FROM payrolls WHERE month=$1 AND year=$2 LIMIT 1', [target.month, target.year]);
      if (existing.rows.length > 0) {
        await finishRun(target, 'skipped', existing.rows[0].id, `Payroll for ${label} already exists — not regenerated`);
        console.log(`[AUTO-PAYROLL] ${label} already exists — skipped`);
        return { status: 'skipped' as const, month: target.month, year: target.year };
      }
      console.log(`[AUTO-PAYROLL] Generating ${label}...`);
      const r = await generatePayrollForMonth(target.month, target.year);
      await finishRun(target, 'completed', r.payrollId, `Generated for ${r.employeeCount} employees`);
      console.log(`[AUTO-PAYROLL] ✅ ${label} generated (${r.employeeCount} employees)`);
      return { status: 'completed' as const, month: target.month, year: target.year, ...r };
    } catch (err: any) {
      if (err?.message === 'ALREADY_EXISTS') {
        await finishRun(target, 'skipped', null, `Payroll for ${label} already exists — not regenerated`);
        return { status: 'skipped' as const, month: target.month, year: target.year };
      }
      await finishRun(target, 'failed', null, String(err?.message || err).slice(0, 500));
      console.error(`[AUTO-PAYROLL] ❌ ${label} failed:`, err);
      return { status: 'failed' as const, month: target.month, year: target.year, error: String(err?.message || err) };
    }
  } finally {
    ticking = false;
  }
}

async function finishRun(t: { month: number; year: number }, status: string, payrollId: string | null, message: string) {
  await payrollPool.query(
    `UPDATE auto_payroll_runs SET status=$3, payroll_id=$4, message=$5, finished_at=NOW() WHERE month=$1 AND year=$2`,
    [t.month, t.year, status, payrollId, message]
  );
}

export function startAutoPayrollScheduler() {
  ensureAutoPayrollTable().catch(e => console.warn('[AUTO-PAYROLL] Table setup failed:', e?.message || e));
  const tick = () => runAutoPayrollCheck().catch(e => console.error('[AUTO-PAYROLL] Tick failed:', e));
  // Every 15 minutes, IST. State lives in the DB, so a restart or missed tick self-heals.
  cron.schedule('*/15 * * * *', tick, { timezone: 'Asia/Kolkata' });
  // Catch-up shortly after boot (server may have been down on the scheduled day).
  setTimeout(tick, 30_000);
  console.log('[AUTO-PAYROLL] Scheduler started');
}