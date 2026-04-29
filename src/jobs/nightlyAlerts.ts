/**
 * Nightly Alerts Job
 * Runs every day at 12:00 AM and sends alert emails to admin + HR
 *
 * Alerts sent:
 *  1. Employees who didn't submit timesheets today
 *  2. Employees absent for 2+ consecutive days
 *  3. Payroll due in 3 days
 *  4. Biometric vs timesheet discrepancy (timesheet > biometric + 2h)
 */

import cron from 'node-cron';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import { Resend } from 'resend';

dotenv.config({ path: './.env' });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const payrollUrl = process.env.PAYROLL_DATABASE_URL as string;
const lmsUrl = process.env.LMS_DATABASE_URL;
const timesheetUrl = process.env.TIMESTRAP_DATABASE_URL || process.env.TIMESHEET_DATABASE_URL || process.env.DATABASE_URL;
const resendApiKey = process.env.RESEND_API_KEY;

function createPool(url: string) {
  return new Pool({
    connectionString: url.replace(/([?&])sslmode=(require|prefer|verify-ca)(&|$)/gi, ''),
    ssl: { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 30000,
  });
}

const payrollPool = createPool(payrollUrl);
const timesheetPool = timesheetUrl ? createPool(timesheetUrl) : null;

// ─── Email sender ─────────────────────────────────────────────────────────────

async function getAlertSettings(client: any): Promise<{
  adminEmails: string[];
  hrEmails: string[];
  fromEmail: string;
  companyName: string;
  payrollDate: number;
}> {
  const res = await client.query(
    `SELECT key, value FROM settings WHERE key IN ('alert_admin_emails','alert_hr_emails','smtp_from','company_email','company_name','payroll_date')`
  );
  const map: Record<string, string> = {};
  res.rows.forEach((r: any) => { map[r.key] = r.value || ''; });

  const parseEmails = (val: string) =>
    val.split(',').map(e => e.trim()).filter(e => e.includes('@'));

  return {
    adminEmails: parseEmails(map.alert_admin_emails || 'sp@ctint.in,durgadevi@ctint.in'),
    hrEmails: parseEmails(map.alert_hr_emails || 'pushpa.p@ctint.in'),
    fromEmail: map.smtp_from || map.company_email || 'onboarding@resend.dev',
    companyName: map.company_name || 'PayrollPro',
    payrollDate: parseInt(map.payroll_date || '1'),
  };
}

async function sendAlertEmail(to: string[], subject: string, html: string, fromEmail: string) {
  if (!resendApiKey || to.length === 0) {
    console.log(`[ALERTS] Would send to: ${to.join(', ')} | Subject: ${subject}`);
    return;
  }

  let pureFrom = fromEmail.includes('<') ? (fromEmail.match(/<([^>]+)>/)?.[1] || fromEmail) : fromEmail;
  if (!pureFrom.includes('@') || pureFrom.includes('example.com') || pureFrom.includes('acmecorp.com')) {
    pureFrom = 'onboarding@resend.dev';
    fromEmail = 'onboarding@resend.dev';
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: fromEmail.includes('<') ? fromEmail : `PayrollPro Alerts <${fromEmail}>`,
        to,
        subject,
        html,
      }),
    });
    const data = await response.json();
    if (response.ok) {
      console.log(`[ALERTS] ✅ Email sent to ${to.join(', ')}`);
    } else {
      console.error(`[ALERTS] ❌ Resend error:`, data);
    }
  } catch (e) {
    console.error(`[ALERTS] Email send failed:`, e);
  }
}

// ─── Alert Logic ──────────────────────────────────────────────────────────────

export async function runNightlyAlerts(testDate?: string) {
  const client = await payrollPool.connect();
  let tsClient: any = null;

  try {
    const now = testDate ? new Date(testDate) : new Date();
    // "yesterday" — the day that just ended (since we run at midnight)
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString().split('T')[0]; // YYYY-MM-DD
    const dayBefore = new Date(yesterday);
    dayBefore.setDate(dayBefore.getDate() - 1);
    const dayBeforeStr = dayBefore.toISOString().split('T')[0];

    const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const displayDate = yesterday.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });

    console.log(`[ALERTS] Running nightly alerts for date: ${dateStr}`);

    // ── Check for Sunday or Holiday ──────────────────────────────────────────
    const dayOfWeek = yesterday.getDay(); // 0 = Sunday
    if (dayOfWeek === 0) {
      console.log(`[ALERTS] 😴 Target date ${dateStr} is a Sunday. Skipping alerts.`);
      return { sent: 0, skipped: 'Sunday' };
    }

    const holidayCheck = await client.query(
      `SELECT name FROM holidays WHERE date = $1`,
      [dateStr]
    );
    if (holidayCheck.rows.length > 0) {
      console.log(`[ALERTS] 🏖️ Target date ${dateStr} is a Holiday (${holidayCheck.rows[0].name}). Skipping alerts.`);
      return { sent: 0, skipped: `Holiday: ${holidayCheck.rows[0].name}` };
    }

    const { adminEmails, hrEmails, fromEmail, companyName, payrollDate } = await getAlertSettings(client);
    const allRecipients = [...new Set([...adminEmails, ...hrEmails])];

    // ── 1. Get all active employees ──────────────────────────────────────────
    const empRes = await client.query(
      `SELECT id, name, email, department, employee_code FROM employees WHERE status = 'active'`
    );
    const employees = empRes.rows;

    // ── 2. Fetch timesheet map from TimeStrap ────────────────────────────────
    const timesheetMap = new Map<string, { minutes: number }>();
    const tsCodeMap = new Map<string, string>();
    const tsNameMap = new Map<string, string>();

    if (timesheetPool) {
      tsClient = await timesheetPool.connect();
      const tsEmpRes = await tsClient.query('SELECT name, email, employee_code FROM employees');
      tsEmpRes.rows.forEach((r: any) => {
        if (r.employee_code) {
          const code = r.employee_code.toUpperCase();
          if (r.email) tsCodeMap.set(r.email.toLowerCase(), code);
          if (r.name) tsNameMap.set(r.name.toLowerCase().trim(), code);
        }
      });

      const tsRes = await tsClient.query(
        `SELECT employee_code, SUM(
          CASE 
            WHEN total_hours ~ '^\\d+h\\s*\\d+m$' THEN
              (REGEXP_MATCH(total_hours, '(\\d+)h'))[1]::int * 60 + (REGEXP_MATCH(total_hours, '(\\d+)m'))[1]::int
            WHEN total_hours ~ '^\\d+h$' THEN
              (REGEXP_MATCH(total_hours, '(\\d+)h'))[1]::int * 60
            ELSE 0
          END
        ) as total_minutes
        FROM time_entries WHERE CAST(date AS date) = $1 GROUP BY employee_code`,
        [dateStr]
      );
      tsRes.rows.forEach((r: any) => {
        const code = (r.employee_code || '').toUpperCase();
        if (code) timesheetMap.set(code, { minutes: parseInt(r.total_minutes) || 0 });
      });
    }

    // ── 3. Fetch attendance for yesterday and day-before ─────────────────────
    const attRes = await client.query(
      `SELECT emp_code,
        MIN(punch_time) as first_punch,
        MAX(punch_time) as last_punch,
        EXTRACT(EPOCH FROM (MAX(punch_time) - MIN(punch_time)))/60 as biometric_minutes
       FROM attendance_logs
       WHERE CAST(punch_time AS date) = $1
       GROUP BY emp_code`,
      [dateStr]
    );
    const attMap = new Map<string, any>();
    attRes.rows.forEach((r: any) => attMap.set(r.emp_code?.toUpperCase(), r));

    const attDayBeforeRes = await client.query(
      `SELECT emp_code FROM attendance_logs WHERE CAST(punch_time AS date) = $1 GROUP BY emp_code`,
      [dayBeforeStr]
    );
    const attDayBeforeCodes = new Set(attDayBeforeRes.rows.map((r: any) => r.emp_code?.toUpperCase()));

    // Resolve each employee's code
    function resolveCode(emp: any): string {
      if (emp.employee_code) return emp.employee_code.toUpperCase();
      if (emp.name?.toUpperCase().includes('REBECA')) return 'E0046';
      const emailKey = (emp.email || '').toLowerCase();
      const nameKey = (emp.name || '').toLowerCase().trim();
      return tsCodeMap.get(emailKey) || tsNameMap.get(nameKey) || emailKey.toUpperCase();
    }

    // ── 4. Build alert lists ─────────────────────────────────────────────────
    const missingTimesheets: string[] = [];
    const consecutiveAbsent: string[] = [];
    const discrepancies: { name: string; biometric: string; timesheet: string; diff: string }[] = [];

    for (const emp of employees) {
      const code = resolveCode(emp);
      const ts = timesheetMap.get(code);
      const att = attMap.get(code);
      const wasPresentDayBefore = attDayBeforeCodes.has(code);

      // 4a. Missing timesheet
      if (!ts || ts.minutes === 0) {
        missingTimesheets.push(emp.name);
      }

      // 4b. Consecutive absence (absent yesterday AND day before)
      if (!att && !wasPresentDayBefore) {
        consecutiveAbsent.push(emp.name);
      }

      // 4c. Biometric vs timesheet discrepancy
      // Alert only when: timesheet_minutes > biometric_minutes + 120 (timesheet claims 2h+ more than physical presence)
      if (att && ts && ts.minutes > 0) {
        const bioMins = parseFloat(att.biometric_minutes) || 0;
        if (ts.minutes > bioMins + 120) {
          const bioH = Math.floor(bioMins / 60);
          const bioM = Math.round(bioMins % 60);
          const tsH = Math.floor(ts.minutes / 60);
          const tsM = ts.minutes % 60;
          const diffMins = ts.minutes - bioMins;
          discrepancies.push({
            name: emp.name,
            biometric: `${bioH}h ${bioM}m`,
            timesheet: `${tsH}h ${tsM}m`,
            diff: `${Math.floor(diffMins / 60)}h ${Math.round(diffMins % 60)}m`,
          });
        }
      }
    }

    // 4d. Payroll due in 3 days
    const today = now.getDate();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();
    const daysUntilPayroll = payrollDate - today;
    let payrollDueAlert: string | null = null;
    if (daysUntilPayroll >= 1 && daysUntilPayroll <= 3) {
      const existingPayroll = await client.query(
        `SELECT id FROM payrolls WHERE month=$1 AND year=$2 AND status IN ('completed','paid')`,
        [currentMonth, currentYear]
      );
      if (existingPayroll.rows.length === 0) {
        payrollDueAlert = `Payroll for ${monthNames[currentMonth - 1]} ${currentYear} is due in ${daysUntilPayroll} day${daysUntilPayroll > 1 ? 's' : ''} (on the ${payrollDate}${payrollDate === 1 ? 'st' : payrollDate === 2 ? 'nd' : payrollDate === 3 ? 'rd' : 'th'}).`;
      }
    }

    // ── 5. Check if there's anything to report ───────────────────────────────
    const hasAlerts = missingTimesheets.length > 0 || consecutiveAbsent.length > 0 || discrepancies.length > 0 || payrollDueAlert;

    if (!hasAlerts) {
      console.log(`[ALERTS] ✅ No alerts for ${dateStr}. All good!`);
      return { sent: 0, alerts: {} };
    }

    // ── 6. Build the email HTML ──────────────────────────────────────────────
    const html = buildAlertEmail({
      date: displayDate,
      companyName,
      missingTimesheets,
      consecutiveAbsent,
      discrepancies,
      payrollDueAlert,
    });

    const subject = `[${companyName}] Daily HR Alerts — ${displayDate}`;

    // ── 7. Send email ────────────────────────────────────────────────────────
    await sendAlertEmail(allRecipients, subject, html, fromEmail);

    // Log to email_logs
    const logNow = new Date();
    for (const recipient of allRecipients) {
      try {
        await client.query(
          `INSERT INTO email_logs (employee_id, payroll_id, email, subject, status, sent_at) VALUES ($1,$2,$3,$4,$5,$6)`,
          [null, null, recipient, subject, 'sent', logNow]
        );
      } catch (_) {}
    }

    console.log(`[ALERTS] Done. Sent to: ${allRecipients.join(', ')}`);
    return {
      sent: allRecipients.length,
      alerts: { missingTimesheets, consecutiveAbsent, discrepancies, payrollDueAlert },
    };

  } catch (err) {
    console.error('[ALERTS] Error running nightly alerts:', err);
    throw err;
  } finally {
    client.release();
    if (tsClient) tsClient.release();
  }
}

// ─── HTML Email Template ──────────────────────────────────────────────────────

function buildAlertEmail({ date, companyName, missingTimesheets, consecutiveAbsent, discrepancies, payrollDueAlert }: any) {
  const section = (title: string, color: string, emoji: string, content: string) => `
    <div style="margin-bottom:24px;">
      <div style="background:${color};border-radius:8px;padding:12px 16px;margin-bottom:12px;">
        <span style="font-size:16px;font-weight:700;color:#1e293b;">${emoji} ${title}</span>
      </div>
      ${content}
    </div>`;

  const badge = (name: string) =>
    `<span style="display:inline-block;background:#f1f5f9;border:1px solid #cbd5e1;border-radius:999px;padding:3px 12px;margin:3px;font-size:13px;color:#334155;font-weight:500;">${name}</span>`;

  let body = '';

  if (missingTimesheets.length > 0) {
    body += section(
      `Timesheet Not Submitted (${missingTimesheets.length} employees)`,
      '#fef3c7',
      '⏰',
      `<p style="color:#64748b;font-size:13px;margin:0 0 8px;">The following employees have <strong>not submitted their timesheet</strong> for ${date}:</p>
       <div>${missingTimesheets.map(badge).join('')}</div>`
    );
  }

  if (consecutiveAbsent.length > 0) {
    body += section(
      `Consecutive Absences (${consecutiveAbsent.length} employees)`,
      '#fee2e2',
      '🔴',
      `<p style="color:#64748b;font-size:13px;margin:0 0 8px;">These employees were <strong>absent for 2 or more consecutive days</strong> (no biometric punch recorded):</p>
       <div>${consecutiveAbsent.map(badge).join('')}</div>`
    );
  }

  if (discrepancies.length > 0) {
    const rows = discrepancies.map(d =>
      `<tr>
        <td style="padding:8px 12px;font-weight:600;color:#334155;font-size:13px;">${d.name}</td>
        <td style="padding:8px 12px;color:#0f766e;font-size:13px;">${d.biometric}</td>
        <td style="padding:8px 12px;color:#7c3aed;font-size:13px;">${d.timesheet}</td>
        <td style="padding:8px 12px;color:#dc2626;font-weight:700;font-size:13px;">+${d.diff} over</td>
      </tr>`
    ).join('');

    body += section(
      `Timesheet vs Biometric Discrepancy (${discrepancies.length} employees)`,
      '#ede9fe',
      '⚠️',
      `<p style="color:#64748b;font-size:13px;margin:0 0 8px;">Timesheet claims <strong>2+ hours more</strong> than biometric presence (9h shift, 1h break expected):</p>
       <table style="width:100%;border-collapse:collapse;font-size:13px;">
         <thead>
           <tr style="background:#f8fafc;">
             <th style="padding:8px 12px;text-align:left;color:#94a3b8;font-size:11px;text-transform:uppercase;">Employee</th>
             <th style="padding:8px 12px;text-align:left;color:#94a3b8;font-size:11px;text-transform:uppercase;">Biometric</th>
             <th style="padding:8px 12px;text-align:left;color:#94a3b8;font-size:11px;text-transform:uppercase;">Timesheet</th>
             <th style="padding:8px 12px;text-align:left;color:#94a3b8;font-size:11px;text-transform:uppercase;">Difference</th>
           </tr>
         </thead>
         <tbody>${rows}</tbody>
       </table>`
    );
  }

  if (payrollDueAlert) {
    body += section(
      'Payroll Due Reminder',
      '#dcfce7',
      '📅',
      `<p style="color:#64748b;font-size:13px;margin:0;">${payrollDueAlert} Please ensure payroll is processed on time.</p>`
    );
  }

  return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:640px;margin:32px auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
    
    <!-- Header -->
    <div style="background:linear-gradient(135deg,#1e40af,#4f46e5);padding:28px 32px;">
      <div style="font-size:22px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">${companyName}</div>
      <div style="font-size:13px;color:#93c5fd;margin-top:4px;">Daily HR Alert Report — ${date}</div>
    </div>

    <!-- Body -->
    <div style="padding:28px 32px;">
      <p style="color:#475569;font-size:14px;margin:0 0 24px;line-height:1.6;">
        This is your automated nightly HR summary. Please review the following alerts and take necessary action.
      </p>
      ${body}
    </div>

    <!-- Footer -->
    <div style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:16px 32px;text-align:center;">
      <p style="color:#94a3b8;font-size:11px;margin:0;">
        This is an automated message from ${companyName} Payroll System. Do not reply.<br/>
        Generated at 12:00 AM on ${date}.
      </p>
    </div>
  </div>
</body>
</html>`;
}

// ─── Cron Scheduler ───────────────────────────────────────────────────────────

export function startNightlyAlertScheduler() {
  // Run every day at 12:00 AM (midnight)
  cron.schedule('0 0 * * *', async () => {
    console.log('[ALERTS] 🕛 Midnight cron triggered — running nightly alerts...');
    try {
      await runNightlyAlerts();
    } catch (err) {
      console.error('[ALERTS] Cron job failed:', err);
    }
  }, {
    timezone: 'Asia/Kolkata' // IST
  });

  console.log('[ALERTS] ✅ Nightly alert scheduler registered (runs at 12:00 AM IST)');
}
