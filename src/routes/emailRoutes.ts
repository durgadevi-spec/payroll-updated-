import { Router } from 'express';
import { Client } from 'pg';
import dotenv from 'dotenv';
import nodemailer from 'nodemailer';

dotenv.config({ path: './.env' });

const payrollUrl = process.env.PAYROLL_DATABASE_URL;
const resendApiKey = process.env.RESEND_API_KEY;

if (!payrollUrl) {
  throw new Error('PAYROLL_DATABASE_URL is required for email routes.');
}

function createClient() {
  return new Client({ connectionString: payrollUrl, ssl: { rejectUnauthorized: false } });
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(value || 0));
}

const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Fetches email settings from the database
 */
async function getEmailSettings() {
  const client = createClient();
  await client.connect();
  try {
    const res = await client.query("SELECT key, value FROM settings WHERE key IN ('smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_from', 'company_email')");
    const settings: Record<string, string> = {};
    res.rows.forEach(row => { settings[row.key] = row.value; });
    return settings;
  } finally {
    await client.end();
  }
}

function buildPayslipHtml(row: any) {
  const perDaySalary = (row.basic_salary || 0) / (row.working_days || 26);
  const sundayEarnings = Math.round(perDaySalary * (row.sunday_work_days || 0) * 100) / 100;

  return `
    <p>Hi ${row.employee_name},</p>
    <p>Your payslip for ${monthNames[row.month - 1]} ${row.year} is ready.</p>
    <table style="width:100%; border-collapse: collapse;">
      <tbody>
        <tr><td style="padding:8px; border:1px solid #ddd;">Basic Salary</td><td style="padding:8px; border:1px solid #ddd;">${formatCurrency(row.basic_salary)}</td></tr>
        ${sundayEarnings > 0 ? `<tr><td style="padding:8px; border:1px solid #ddd;">Sunday Work Earnings</td><td style="padding:8px; border:1px solid #ddd;">${formatCurrency(sundayEarnings)}</td></tr>` : ''}
        <tr><td style="padding:8px; border:1px solid #ddd;">Leave Deduction</td><td style="padding:8px; border:1px solid #ddd;">-${formatCurrency(row.leave_deduction)}</td></tr>
        <tr><td style="padding:8px; border:1px solid #ddd;">Timesheet Deduction</td><td style="padding:8px; border:1px solid #ddd;">-${formatCurrency(row.timesheet_deduction)}</td></tr>
        <tr><td style="padding:8px; border:1px solid #ddd;">PF Deduction</td><td style="padding:8px; border:1px solid #ddd;">-${formatCurrency(row.pf_deduction)}</td></tr>
        <tr><td style="padding:8px; border:1px solid #ddd;">ESI Deduction</td><td style="padding:8px; border:1px solid #ddd;">-${formatCurrency(row.esi_deduction)}</td></tr>
        <tr><td style="padding:8px; border:1px solid #ddd;">Tax Deduction</td><td style="padding:8px; border:1px solid #ddd;">-${formatCurrency(row.tax_deduction)}</td></tr>
        <tr><td style="padding:8px; border:1px solid #ddd;">Loan Deduction</td><td style="padding:8px; border:1px solid #ddd;">-${formatCurrency(row.loan_deduction)}</td></tr>
        <tr><td style="padding:8px; border:1px solid #ddd;">Advance Deduction</td><td style="padding:8px; border:1px solid #ddd;">-${formatCurrency(row.advance_deduction)}</td></tr>
        <tr><td style="padding:8px; border:1px solid #ddd;">Bonus</td><td style="padding:8px; border:1px solid #ddd;">+${formatCurrency(row.bonus)}</td></tr>
        <tr><td style="padding:8px; border:1px solid #ddd; font-weight:bold;">Net Salary</td><td style="padding:8px; border:1px solid #ddd; font-weight:bold;">${formatCurrency(row.net_salary)}</td></tr>
      </tbody>
    </table>
    <p>Thanks,<br/>Payroll Team</p>
  `;
}

async function sendEmail({ to, subject, html, text }: { to: string; subject: string; html: string; text: string }) {
  const settings = await getEmailSettings();
  
  // Try SMTP first if configured
  if (settings.smtp_host && settings.smtp_user) {
    console.log(`[EMAIL] Attempting SMTP send to ${to} using ${settings.smtp_host}`);
    const transporter = nodemailer.createTransport({
      host: settings.smtp_host,
      port: parseInt(settings.smtp_port || '587'),
      secure: settings.smtp_port === '465',
      auth: {
        user: settings.smtp_user,
        pass: settings.smtp_pass || process.env.SMTP_PASSWORD || '',
      },
      tls: { rejectUnauthorized: false }
    });

    return transporter.sendMail({
      from: settings.smtp_from || settings.company_email || 'hr@company.com',
      to,
      subject,
      html,
      text,
    });
  }

  // Fallback to Resend if API key is present
  if (resendApiKey) {
    console.log(`[EMAIL] Attempting Resend API send to ${to}`);
    const emailFrom = settings.smtp_from || settings.company_email || process.env.EMAIL_FROM || 'admin@company.com';
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: emailFrom,
        to: [to],
        subject,
        html,
        text,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Resend API error ${response.status}: ${errorText}`);
    }

    return response.json();
  }

  throw new Error('No email configuration found. Please configure SMTP in Settings or provide a RESEND_API_KEY.');
}

const router = Router();

router.post('/email/send', async (req, res) => {
  const { payslipIds } = req.body;
  if (!Array.isArray(payslipIds) || payslipIds.length === 0) {
    return res.status(400).json({ error: 'Missing payslipIds' });
  }

  const client = createClient();
  await client.connect();

  try {
    const query = `
      SELECT p.id AS payslip_id,
             p.employee_id,
             p.payroll_id,
             e.name AS employee_name,
             e.email,
             pr.month,
             pr.year,
             pi.*
      FROM payslips p
      JOIN employees e ON p.employee_id = e.id
      JOIN payrolls pr ON p.payroll_id = pr.id
      JOIN payroll_items pi ON p.payroll_id = pi.payroll_id AND p.employee_id = pi.employee_id
      WHERE p.id = ANY($1)
    `;

    const result = await client.query(query, [payslipIds]);
    if (!result.rows.length) {
      return res.status(404).json({ error: 'No matching payslips were found.' });
    }

    let sentCount = 0;
    let failedCount = 0;
    const now = new Date();

    for (const row of result.rows) {
      const subject = `Payslip for ${monthNames[row.month - 1]} ${row.year}`;
      const text = `Hello ${row.employee_name},\n\nYour payslip for ${monthNames[row.month - 1]} ${row.year} is ready.\n\nNet salary: ${formatCurrency(row.net_salary)}\n\nThank you,\nPayroll Team`;
      const html = buildPayslipHtml(row);

      try {
        await sendEmail({ to: row.email, subject, html, text });
        await client.query(
          `INSERT INTO email_logs (employee_id, payroll_id, email, subject, status, sent_at) VALUES ($1, $2, $3, $4, $5, $6)`,
          [row.employee_id, row.payroll_id, row.email, subject, 'sent', now]
        );
        await client.query(`UPDATE payslips SET email_sent = true, email_sent_at = $1 WHERE id = $2`, [now, row.payslip_id]);
        sentCount += 1;
      } catch (error) {
        const message = String((error as any).message || 'Unknown error');
        await client.query(
          `INSERT INTO email_logs (employee_id, payroll_id, email, subject, status, error_message, sent_at) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [row.employee_id, row.payroll_id, row.email, subject, 'failed', message, now]
        );
        failedCount += 1;
      }
    }

    res.json({ sentCount, failedCount });
  } catch (error) {
    console.error('Error sending payslip emails:', error);
    res.status(500).json({ error: 'Failed to send payslip emails' });
  } finally {
    await client.end();
  }
});

router.post('/email/resend/:logId', async (req, res) => {
  const { logId } = req.params;
  const client = createClient();
  await client.connect();

  try {
    const query = `
      SELECT l.id AS log_id,
             l.employee_id,
             l.payroll_id,
             l.email,
             l.subject,
             e.name AS employee_name,
             pr.month,
             pr.year,
             pi.*,
             p.id AS payslip_id
      FROM email_logs l
      JOIN employees e ON l.employee_id = e.id
      JOIN payrolls pr ON l.payroll_id = pr.id
      JOIN payroll_items pi ON l.payroll_id = pi.payroll_id AND l.employee_id = pi.employee_id
      JOIN payslips p ON p.payroll_id = l.payroll_id AND p.employee_id = l.employee_id
      WHERE l.id = $1
    `;

    const result = await client.query(query, [logId]);
    if (!result.rows.length) {
      return res.status(404).json({ error: 'Email log entry not found.' });
    }

    const row = result.rows[0];
    const text = `Hello ${row.employee_name},\n\nYour payslip for ${monthNames[row.month - 1]} ${row.year} is ready.\n\nNet salary: ${formatCurrency(row.net_salary)}\n\nThank you,\nPayroll Team`;
    const html = buildPayslipHtml(row);
    const now = new Date();

    try {
      await sendEmail({ to: row.email, subject: row.subject || `Payslip for ${monthNames[row.month - 1]} ${row.year}`, html, text });
      await client.query(`UPDATE email_logs SET status=$1, error_message=$2, sent_at=$3 WHERE id=$4`, ['sent', null, now, logId]);
      await client.query(`UPDATE payslips SET email_sent = true, email_sent_at = $1 WHERE id = $2`, [now, row.payslip_id]);
      res.json({ success: true });
    } catch (error) {
      const message = String((error as any).message || 'Unknown error');
      await client.query(`UPDATE email_logs SET status=$1, error_message=$2, sent_at=$3 WHERE id=$4`, ['failed', message, now, logId]);
      res.status(500).json({ error: 'Failed to resend email', details: message });
    }
  } catch (error) {
    console.error('Error resending email:', error);
    res.status(500).json({ error: 'Failed to resend email' });
  } finally {
    await client.end();
  }
});

router.post('/email/send-manual', async (req, res) => {
  const { employeeId, email, subject, body, payslipId } = req.body;
  if (!employeeId || !email) {
    return res.status(400).json({ error: 'Employee ID and email are required' });
  }

  const client = createClient();
  await client.connect();

  try {
    let html = body || '';
    let text = body || '';
    let finalSubject = subject || 'Notification from Payroll';
    let payrollId = null;

    if (payslipId) {
      const query = `
        SELECT e.name AS employee_name, pr.month, pr.year, pi.*
        FROM payslips p
        JOIN employees e ON p.employee_id = e.id
        JOIN payrolls pr ON p.payroll_id = pr.id
        JOIN payroll_items pi ON p.payroll_id = pi.payroll_id AND p.employee_id = pi.employee_id
        WHERE p.id = $1
      `;
      const result = await client.query(query, [payslipId]);
      if (result.rows.length > 0) {
        const row = result.rows[0];
        html = buildPayslipHtml(row);
        text = `Hello ${row.employee_name},\n\nYour payslip for ${monthNames[row.month - 1]} ${row.year} is ready.\n\nNet salary: ${formatCurrency(row.net_salary)}\n\nThank you,\nPayroll Team`;
        finalSubject = subject || `Payslip for ${monthNames[row.month - 1]} ${row.year}`;
        payrollId = row.payroll_id;
      }
    }

    const now = new Date();
    try {
      await sendEmail({ to: email, subject: finalSubject, html, text });
      await client.query(
        `INSERT INTO email_logs (employee_id, payroll_id, email, subject, status, sent_at) VALUES ($1, $2, $3, $4, $5, $6)`,
        [employeeId, payrollId, email, finalSubject, 'sent', now]
      );
      res.json({ success: true });
    } catch (error) {
      const message = String((error as any).message || 'Unknown error');
      await client.query(
        `INSERT INTO email_logs (employee_id, payroll_id, email, subject, status, error_message, sent_at) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [employeeId, payrollId, email, finalSubject, 'failed', message, now]
      );
      res.status(500).json({ error: 'Failed to send email', details: message });
    }
  } catch (error) {
    console.error('Error sending manual email:', error);
    res.status(500).json({ error: 'Failed to send manual email' });
  } finally {
    await client.end();
  }
});

export { router as emailRouter };