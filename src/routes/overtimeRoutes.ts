import { Router } from 'express';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import { payrollPool } from './payrollRoutes.ts';

// ─────────────────────────────────────────────────────────────────────────────
// OVERTIME (OT) — completely standalone module.
//
// Employees apply for OT in the LMS (date, hours / from-to time, status…).
// This route reads those OT requests straight from the LMS database, works out
// the PER-HOUR salary from the employee's monthly salary, and returns the OT
// amount. It is READ-ONLY: it does not touch payroll generation, payslips or any
// other existing table / route.
//
//   per-day salary  = monthly salary / days-in-month (same basis as payroll)
//   per-hour salary = per-day salary / hours-per-day (default 8)
//   OT amount       = OT hours × per-hour salary          ← 1x, NOT double
//
// monthly salary = employees.ctc / 12  (same as the rest of the app)
//
// Env (optional):
//   LMS_OT_TABLE   name of the LMS OT table (auto-detected if not set)
// ─────────────────────────────────────────────────────────────────────────────

dotenv.config({ path: './.env' });

const lmsUrl = process.env.LMS_DATABASE_URL;

function normalizeConnectionString(connectionString: string) {
  try {
    const url = new URL(connectionString);
    url.searchParams.delete('sslmode');
    return url.toString();
  } catch {
    return connectionString.replace(/([?&])sslmode=(require|prefer|verify-ca)(&|$)/gi, (_m, sep, _mode, tail) =>
      sep === '?' ? (tail ? '?' : '') : tail ? sep : ''
    );
  }
}

// Small dedicated pool so this module never competes with / changes the existing pools.
const otLmsPool = lmsUrl
  ? new Pool({
      connectionString: normalizeConnectionString(lmsUrl),
      ssl: { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 60000,
      connectionTimeoutMillis: 30000,
      query_timeout: 60000,
    })
  : null;

export const overtimeRouter = Router();

// ─── Helpers ────────────────────────────────────────────────────────────────

const round2 = (n: number) => Math.round(n * 100) / 100;

// Pick the first non-empty value among candidate keys of a row (case-insensitive).
function pick(row: Record<string, any>, keys: string[]): any {
  const lower: Record<string, any> = {};
  for (const k of Object.keys(row)) lower[k.toLowerCase()] = row[k];
  for (const k of keys) {
    const v = lower[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return null;
}

const USER_KEYS = ['user_id', 'employee_code', 'emp_code', 'employee_id', 'userid'];
const DATE_KEYS = ['ot_date', 'overtime_date', 'work_date', 'date', 'request_date', 'start_date', 'from_date'];
const HOURS_KEYS = ['total_hours', 'ot_hours', 'overtime_hours', 'hours', 'no_of_hours', 'duration_hours', 'duration', 'total_ot_hours'];
const FROM_KEYS = ['from_time', 'start_time', 'ot_from', 'ot_start_time', 'in_time', 'od_from_time'];
const TO_KEYS = ['to_time', 'end_time', 'ot_to', 'ot_end_time', 'out_time', 'od_to_time'];
const STATUS_KEYS = ['status', 'approval_status', 'request_status'];
const REASON_KEYS = ['reason', 'remarks', 'description', 'purpose', 'comments', 'work_description'];
const EMAIL_KEYS = ['email', 'user_email'];

// "YYYY-MM-DD" in IST regardless of whether the DB gave us a Date or a string.
function toDateKey(v: any): string | null {
  if (!v) return null;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

// Minutes since midnight from "HH:MM[:SS]" or a timestamp / Date.
function toMinutes(v: any): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'string') {
    const m = v.match(/^(\d{1,2}):(\d{2})(?::\d{2})?(?:\s*(AM|PM))?$/i);
    if (m) {
      let h = Number(m[1]);
      const min = Number(m[2]);
      const ap = m[3]?.toUpperCase();
      if (ap === 'PM' && h < 12) h += 12;
      if (ap === 'AM' && h === 12) h = 0;
      return h * 60 + min;
    }
  }
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d);
  const h = Number(parts.find(p => p.type === 'hour')?.value || 0) % 24;
  const m = Number(parts.find(p => p.type === 'minute')?.value || 0);
  return h * 60 + m;
}

// Hours may be a number ("2.5"), "HH:MM" ("02:30") or derived from from/to time.
function resolveHours(row: Record<string, any>): number {
  const raw = pick(row, HOURS_KEYS);
  if (raw !== null) {
    const s = String(raw).trim();
    const hm = s.match(/^(\d+):(\d{2})(?::\d{2})?$/);
    if (hm) return Number(hm[1]) + Number(hm[2]) / 60;
    const n = parseFloat(s);
    if (Number.isFinite(n) && n > 0) return n;
  }

  const from = toMinutes(pick(row, FROM_KEYS));
  const to = toMinutes(pick(row, TO_KEYS));
  if (from !== null && to !== null) {
    let diff = to - from;
    if (diff < 0) diff += 24 * 60; // overnight OT
    return diff / 60;
  }

  return 0;
}

// Find the LMS OT table: env override → named OT table → LMS leaves table.
let cachedOtTable: string | null = null;
async function resolveOtTable(client: any): Promise<string | null> {
  if (process.env.LMS_OT_TABLE) return process.env.LMS_OT_TABLE;
  if (cachedOtTable) return cachedOtTable;

  const r = await client.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
       AND (table_name ILIKE '%overtime%' OR table_name ILIKE 'ot\\_%' OR table_name ILIKE '%\\_ot' OR table_name ILIKE '%\\_ot\\_%' OR table_name = 'ot')
     ORDER BY (table_name ILIKE '%request%') DESC, (table_name ILIKE '%overtime%') DESC, table_name ASC`
  );
  if (r.rows[0]?.table_name) {
    cachedOtTable = r.rows[0].table_name;
    return cachedOtTable;
  }

  const leaves = await client.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name = 'leaves'`
  );
  cachedOtTable = leaves.rows[0]?.table_name ?? null;
  return cachedOtTable;
}

// Table name comes from env / information_schema only, but quote it defensively anyway.
const quoteIdent = (s: string) => `"${s.replace(/"/g, '""')}"`;

// ─── GET /api/overtime/lms-schema  (diagnostic) ─────────────────────────────
// Shows which OT table was found in the LMS DB, its columns and a sample row,
// so it is easy to confirm the column mapping.
overtimeRouter.get('/overtime/lms-schema', async (_req, res) => {
  if (!otLmsPool) return res.status(503).json({ error: 'LMS_DATABASE_URL is not configured' });
  let client;
  try {
    client = await otLmsPool.connect();
    const table = await resolveOtTable(client);
    const all = await client.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name`);
    if (!table) {
      return res.json({ table: null, message: 'No OT-like table found. Set LMS_OT_TABLE in .env to the exact table name.', all_tables: all.rows.map((r: any) => r.table_name) });
    }
    const cols = await client.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`, [table]);
    const sample = table === 'leaves'
      ? await client.query(`SELECT * FROM ${quoteIdent(table)} WHERE lower(trim(leave_type)) = 'ot' LIMIT 3`)
      : await client.query(`SELECT * FROM ${quoteIdent(table)} LIMIT 3`);
    res.json({ table, columns: cols.rows, sample: sample.rows, all_tables: all.rows.map((r: any) => r.table_name) });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to inspect LMS schema' });
  } finally {
    if (client) client.release();
  }
});

// ─── GET /api/overtime?month=&year=&status=approved|all&hours_per_day=8&basis=calendar|working
overtimeRouter.get('/overtime', async (req, res) => {
  const now = new Date();
  const month = Number(req.query.month) || now.getMonth() + 1;
  const year = Number(req.query.year) || now.getFullYear();
  const statusFilter = String(req.query.status || 'approved').toLowerCase(); // approved | all
  const hoursPerDay = Math.max(1, Number(req.query.hours_per_day) || 8);
  const basis = String(req.query.basis || 'calendar').toLowerCase() === 'working' ? 'working' : 'calendar';

  if (!otLmsPool) return res.status(503).json({ error: 'LMS_DATABASE_URL is not configured' });

  const mm = String(month).padStart(2, '0');
  const calendarDays = new Date(year, month, 0).getDate();
  const monthStart = `${year}-${mm}-01`;
  const monthEnd = `${year}-${mm}-${String(calendarDays).padStart(2, '0')}`;

  // Days used for the per-day rate: calendar days (default — same as payroll) or
  // working days (month days minus Sundays).
  let daysForRate = calendarDays;
  if (basis === 'working') {
    let sundays = 0;
    for (let d = 1; d <= calendarDays; d++) if (new Date(year, month - 1, d).getDay() === 0) sundays++;
    daysForRate = calendarDays - sundays;
  }

  let lmsClient: any;
  let pClient: any;
  try {
    lmsClient = await otLmsPool.connect();
    const table = await resolveOtTable(lmsClient);
    if (!table) {
      return res.json({
        month, year, table: null, rows: [], employees: [],
        totals: { requests: 0, hours: 0, amount: 0, employees: 0 },
        warning: 'No OT table found in the LMS database. Set LMS_OT_TABLE in .env (see /api/overtime/lms-schema).',
      });
    }

    // When the LMS stores OT in its shared leaves table, never include OD or
    // other leave types in the overtime report.
    const rawRes = table === 'leaves'
      ? await lmsClient.query(`SELECT to_jsonb(o) AS r FROM ${quoteIdent(table)} o WHERE lower(trim(o.leave_type)) = 'ot'`)
      : await lmsClient.query(`SELECT to_jsonb(o) AS r FROM ${quoteIdent(table)} o`);
    const lmsRows: Record<string, any>[] = rawRes.rows.map((x: any) => x.r);

    // LMS user → email map (to match when OT row has no employee code).
    const userEmailByCode = new Map<string, string>();
    try {
      const u = await lmsClient.query('SELECT user_id, email FROM users');
      u.rows.forEach((x: any) => { if (x.user_id && x.email) userEmailByCode.set(String(x.user_id).trim().toUpperCase(), String(x.email).toLowerCase()); });
    } catch { /* optional */ }

    pClient = await payrollPool.connect();
    const empRes = await pClient.query(`SELECT id, name, email, employee_code, department, designation, ctc FROM employees`);
    const byCode = new Map<string, any>();
    const byEmail = new Map<string, any>();
    const byId = new Map<string, any>();
    empRes.rows.forEach((e: any) => {
      if (e.employee_code) byCode.set(String(e.employee_code).trim().toUpperCase(), e);
      if (e.email) byEmail.set(String(e.email).trim().toLowerCase(), e);
      byId.set(String(e.id), e);
    });

    const rows: any[] = [];
    let skippedUnmatched = 0;

    for (const r of lmsRows) {
      const dateKey = toDateKey(pick(r, DATE_KEYS));
      if (!dateKey || dateKey < monthStart || dateKey > monthEnd) continue;

      const status = String(pick(r, STATUS_KEYS) ?? '').trim();
      if (statusFilter !== 'all' && status.toLowerCase() !== 'approved') continue;

      const hours = round2(resolveHours(r));
      if (hours <= 0) continue;

      const userKey = String(pick(r, USER_KEYS) ?? '').trim();
      const emailKey = String(pick(r, EMAIL_KEYS) ?? userEmailByCode.get(userKey.toUpperCase()) ?? '').trim().toLowerCase();
      const emp = byCode.get(userKey.toUpperCase()) || (emailKey && byEmail.get(emailKey)) || byId.get(userKey);
      if (!emp) { skippedUnmatched++; continue; }

      const monthlySalary = Number(emp.ctc || 0) / 12;
      const perDay = daysForRate > 0 ? monthlySalary / daysForRate : 0;
      const perHour = perDay / hoursPerDay;
      const amount = round2(hours * perHour); // 1x per-hour rate (no double pay)

      rows.push({
        id: String(pick(r, ['id']) ?? `${emp.id}-${dateKey}-${rows.length}`),
        employee_id: emp.id,
        employee_name: emp.name,
        employee_code: emp.employee_code || userKey,
        department: emp.department || '',
        designation: emp.designation || '',
        ot_date: dateKey,
        from_time: pick(r, FROM_KEYS) ? String(pick(r, FROM_KEYS)).slice(0, 8) : null,
        to_time: pick(r, TO_KEYS) ? String(pick(r, TO_KEYS)).slice(0, 8) : null,
        ot_hours: hours,
        status: status || '—',
        reason: pick(r, REASON_KEYS) ? String(pick(r, REASON_KEYS)) : '',
        monthly_salary: round2(monthlySalary),
        per_day_salary: round2(perDay),
        per_hour_salary: round2(perHour),
        ot_amount: amount,
      });
    }

    rows.sort((a, b) => (a.ot_date < b.ot_date ? -1 : a.ot_date > b.ot_date ? 1 : a.employee_name.localeCompare(b.employee_name)));

    // Per-employee roll-up
    const empMap = new Map<string, any>();
    for (const row of rows) {
      const cur = empMap.get(row.employee_id) || {
        employee_id: row.employee_id, employee_name: row.employee_name, employee_code: row.employee_code,
        department: row.department, designation: row.designation,
        monthly_salary: row.monthly_salary, per_hour_salary: row.per_hour_salary,
        requests: 0, ot_hours: 0, ot_amount: 0,
      };
      cur.requests += 1;
      cur.ot_hours = round2(cur.ot_hours + row.ot_hours);
      cur.ot_amount = round2(cur.ot_amount + row.ot_amount);
      empMap.set(row.employee_id, cur);
    }
    const employees = Array.from(empMap.values()).sort((a, b) => a.employee_name.localeCompare(b.employee_name));

    res.json({
      month, year, table,
      settings: { hours_per_day: hoursPerDay, basis, days_for_rate: daysForRate, multiplier: 1, status: statusFilter },
      rows,
      employees,
      totals: {
        requests: rows.length,
        employees: employees.length,
        hours: round2(rows.reduce((s, r) => s + r.ot_hours, 0)),
        amount: round2(rows.reduce((s, r) => s + r.ot_amount, 0)),
      },
      skipped_unmatched: skippedUnmatched,
    });
  } catch (err: any) {
    console.error('[OVERTIME] Error:', err);
    res.status(500).json({ error: err?.message || 'Failed to load overtime' });
  } finally {
    if (lmsClient) lmsClient.release();
    if (pClient) pClient.release();
  }
});