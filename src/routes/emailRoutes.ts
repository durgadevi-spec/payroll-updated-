import { Router } from 'express';
import { Client } from 'pg';
import dotenv from 'dotenv';
import nodemailer from 'nodemailer';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

dotenv.config({ path: './.env' });

const payrollUrl = process.env.PAYROLL_DATABASE_URL;
const resendApiKey = process.env.RESEND_API_KEY;

if (!payrollUrl) {
  throw new Error('PAYROLL_DATABASE_URL is required for email routes.');
}

function createClient() {
  return new Client({ connectionString: payrollUrl, ssl: { rejectUnauthorized: false } });
}

function formatCurrency(value: number, skipSymbol: boolean = false) {
  if (skipSymbol) return new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value || 0));
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
  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
      <h2 style="color: #1e40af; margin-bottom: 5px;">Concept Trunk Interiors</h2>
      <p style="color: #64748b; font-size: 14px; margin-top: 0;">Payroll Department</p>
      
      <div style="background-color: #f8fafc; padding: 15px; border-radius: 8px; margin: 20px 0;">
        <h3 style="margin-top: 0; color: #334155;">Hello ${row.employee_name},</h3>
        <p style="color: #475569; line-height: 1.5;">Your payslip for <strong>${monthNames[row.month - 1]} ${row.year}</strong> has been generated and is attached to this email as a PDF document.</p>
        
        <div style="display: flex; justify-content: space-between; border-top: 1px solid #e2e8f0; padding-top: 15px; margin-top: 15px;">
          <div>
            <p style="margin: 0; font-size: 12px; color: #94a3b8; text-transform: uppercase;">Net Salary</p>
            <p style="margin: 0; font-size: 20px; font-weight: bold; color: #0f172a;">${formatCurrency(row.net_salary)}</p>
          </div>
          <div style="text-align: right;">
            <p style="margin: 0; font-size: 12px; color: #94a3b8; text-transform: uppercase;">Payable Days</p>
            <p style="margin: 0; font-size: 16px; font-weight: bold; color: #0f172a;">${row.working_days || 26}</p>
          </div>
        </div>
      </div>
      
      <p style="color: #64748b; font-size: 12px; text-align: center; margin-top: 30px;">
        This is an automated notification. Please do not reply to this email.
      </p>
    </div>
  `;
}

function generatePayslipPdf(row: any, templateContent?: any) {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  
  const header = templateContent?.header || {
    title: 'CONCEPT TRUNK INTERIORS',
    address: '2/36 A, Indira Gandhi Street, Perumbakkam Main Rd, Chennai, Tamil Nadu 600100',
    logoText: 'CT',
    showLogo: true
  };

  // 1. Logo Box (Top Left)
  if (header.showLogo) {
    doc.setFillColor(0, 0, 0);
    doc.rect(14, 10, 25, 25, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.text(header.logoText || 'CT', 26.5, 23, { align: 'center' });
    doc.setFontSize(5);
    doc.text('CONCEPT TRUNK', 26.5, 30, { align: 'center' });
  }
  
  // 2. Company Name (Top Right)
  doc.setTextColor(30, 41, 59);
  doc.setFontSize(22);
  doc.setFont('helvetica', 'bold');
  doc.text(header.title || 'CONCEPT TRUNK INTERIORS', 45, 22);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139);
  doc.text(header.address || '2/36 A, Indira Gandhi Street, Perumbakkam Main Rd, Chennai, Tamil Nadu 600100', 45, 28);
  
  // 3. Title Bar
  doc.setDrawColor(226, 232, 240);
  doc.line(14, 40, pageWidth - 14, 40);
  doc.line(14, 48, pageWidth - 14, 48);
  doc.setTextColor(15, 23, 42);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text(`PAY SLIP — ${monthNames[row.month - 1].toUpperCase()} ${row.year}`, pageWidth / 2, 45, { align: 'center' });
  
  // 4. Employee Information Table
  autoTable(doc, {
    startY: 55,
    body: [
      [{ content: 'Employee Code', styles: { fontStyle: 'bold', fillColor: [248, 250, 252] } }, row.employee_id?.substring(0, 8).toUpperCase(), { content: 'Employee Name', styles: { fontStyle: 'bold', fillColor: [248, 250, 252] } }, row.employee_name || '—'],
      [{ content: 'Designation', styles: { fontStyle: 'bold', fillColor: [248, 250, 252] } }, row.designation || '—', { content: 'Department', styles: { fontStyle: 'bold', fillColor: [248, 250, 252] } }, row.department || '—'],
      [{ content: 'Mode of Pay', styles: { fontStyle: 'bold', fillColor: [248, 250, 252] } }, 'Bank Transfer', { content: 'Bank (A/C)', styles: { fontStyle: 'bold', fillColor: [248, 250, 252] } }, row.bank_account || '—'],
      [{ content: 'Payable Days', styles: { fontStyle: 'bold', fillColor: [248, 250, 252] } }, row.working_days || '0', { content: 'Date of Joining', styles: { fontStyle: 'bold', fillColor: [248, 250, 252] } }, row.joining_date ? new Date(row.joining_date).toLocaleDateString() : '—'],
    ],
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 2, lineColor: [203, 213, 225], lineWidth: 0.1 },
  });
  
  // 5. Earnings & Deductions Table
  const perDaySalary = (row.basic_salary || 0) / (row.working_days || 26);
  const sundayEarnings = Math.round(perDaySalary * (row.sunday_work_days || 0) * 100) / 100;
  
  const earningsData = templateContent?.sections?.earnings?.rows?.map((r: any) => {
    let val = 0;
    if (r.key === 'basic_salary') val = row.basic_salary || 0;
    else if (r.key === 'sunday_work_earnings') val = sundayEarnings || 0;
    else if (r.key === 'bonus') val = row.bonus || 0;
    return [r.label, formatCurrency(val, true)];
  }) || [
    ['Basic Salary', formatCurrency(row.basic_salary, true)],
    ['Sunday Work Earnings', formatCurrency(sundayEarnings, true)],
    ['Special Allowance / Bonus', formatCurrency(row.bonus || 0, true)],
  ];

  const totalEarnings = templateContent?.sections?.earnings?.rows?.reduce((sum: number, r: any) => {
    let val = 0;
    if (r.key === 'basic_salary') val = Number(row.basic_salary || 0);
    else if (r.key === 'sunday_work_earnings') val = Number(sundayEarnings || 0);
    else if (r.key === 'bonus') val = Number(row.bonus || 0);
    return sum + val;
  }, 0) || (Number(row.basic_salary || 0) + Number(sundayEarnings || 0) + Number(row.bonus || 0));

  earningsData.push(['Gross Earnings', formatCurrency(totalEarnings, true)]);
  
  const deductionsData = templateContent?.sections?.deductions?.rows?.map((r: any) => {
    let val = 0;
    if (r.key === 'leave_deduction') val = Number(row.leave_deduction || 0);
    else if (r.key === 'pf_deduction') val = Number(row.pf_deduction || 0);
    else if (r.key === 'esi_deduction') val = Number(row.esi_deduction || 0);
    else if (r.key === 'tax_deduction') val = Number(row.tax_deduction || 0);
    else if (r.key === 'loan_deduction') val = Number(row.loan_deduction || 0);
    else if (r.key === 'advance_deduction') val = Number(row.advance_deduction || 0);
    else if (r.key === 'total_deductions') {
      val = Number(row.pf_deduction || 0) + Number(row.esi_deduction || 0) + Number(row.loan_deduction || 0) + Number(row.advance_deduction || 0) + Number(row.leave_deduction || 0);
    }
    return [r.label, formatCurrency(val, true)];
  }) || [
    ['Leave (LOP)', formatCurrency(row.leave_deduction || 0, true)],
    ['Statutory (PF/ESI)', formatCurrency(Number(row.pf_deduction || 0) + Number(row.esi_deduction || 0), true)],
    ['Loan / Advance Recovery', formatCurrency(Number(row.loan_deduction || 0) + Number(row.advance_deduction || 0), true)],
    ['Total Deductions', formatCurrency(Number(row.pf_deduction || 0) + Number(row.esi_deduction || 0) + Number(row.loan_deduction || 0) + Number(row.advance_deduction || 0) + Number(row.leave_deduction || 0), true)],
  ];
  
  autoTable(doc, {
    startY: (doc as any).lastAutoTable.finalY + 8,
    head: [[
      { content: templateContent?.sections?.earnings?.title || 'EARNINGS', styles: { fillColor: [226, 232, 240] } }, 
      { content: 'Amount (INR)', styles: { fillColor: [226, 232, 240], halign: 'right' } }, 
      { content: templateContent?.sections?.deductions?.title || 'DEDUCTIONS', styles: { fillColor: [226, 232, 240] } }, 
      { content: 'Amount (INR)', styles: { fillColor: [226, 232, 240], halign: 'right' } }
    ]],
    body: earningsData.map((e: any, i: number) => {
      const isLastRow = i === earningsData.length - 1;
      const d = deductionsData[i] || ['', ''];
      return [
        { content: e[0], styles: { fontStyle: isLastRow ? 'bold' : 'normal' } },
        { content: e[1], styles: { halign: 'right', fontStyle: isLastRow ? 'bold' : 'normal' } },
        { content: d[0], styles: { fontStyle: isLastRow ? 'bold' : 'normal' } },
        { content: d[1], styles: { halign: 'right', fontStyle: isLastRow ? 'bold' : 'normal' } }
      ];
    }),
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 2, lineColor: [203, 213, 225], lineWidth: 0.1 },
  });
  
  // 6. Net Pay Summary
  const netPayY = (doc as any).lastAutoTable.finalY + 8;
  doc.setDrawColor(15, 23, 42);
  doc.setFillColor(241, 245, 249);
  doc.rect(14, netPayY, pageWidth - 28, 12, 'FD');
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text(templateContent?.sections?.summary?.title || 'Net Pay (Gross - Deductions)', 18, netPayY + 7.5);
  doc.text(formatCurrency(row.net_salary, true), pageWidth - 18, netPayY + 7.5, { align: 'right' });
  
  // 7. Remarks & Footer
  doc.setTextColor(100, 116, 139);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  const footerY = netPayY + 18;
  doc.text('Remarks:', 14, footerY);
  
  const remarks = templateContent?.sections?.footer?.remarks || [
    'This is a computer generated payslip and does not require a physical signature.',
    'Verify bank account details before initiating transfers.',
    'Keep this payslip for your personal records and statutory compliance.'
  ];

  remarks.forEach((remark: string, index: number) => {
    doc.text(`- ${remark}`, 14, footerY + 4 + (index * 4));
  });
  
  if (templateContent?.sections?.footer?.showGeneratedDate !== false) {
    doc.setDrawColor(241, 245, 249);
    doc.line(14, footerY + 20 + (remarks.length * 2), pageWidth - 14, footerY + 20 + (remarks.length * 2));
    doc.text(`Generated on: ${new Date().toLocaleDateString()}`, 14, footerY + 25 + (remarks.length * 2));
    doc.text('Electronic Copy', pageWidth - 14, footerY + 25 + (remarks.length * 2), { align: 'right' });
  }
  
  return Buffer.from(doc.output('arraybuffer'));
}

export async function sendEmail({ to, subject, html, text, attachments }: { to: string; subject: string; html: string; text: string, attachments?: any[] }) {
  const settings = await getEmailSettings();
  
  // Ensure 'to' is a valid email format to satisfy Resend/SMTP requirements
  const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  if (!isValidEmail(to)) {
    console.warn(`[EMAIL] Invalid recipient address skipped: ${to}`);
    throw new Error(`Invalid email format: "${to}". Please update the employee's email address.`);
  }

  // 1. Prioritize Resend if API key is present
  if (resendApiKey) {
    try {
      const maskedKey = resendApiKey.length > 5 ? `...${resendApiKey.slice(-5)}` : 'INVALID_KEY';
      console.log(`[EMAIL] Attempting Resend API send to ${to} (using key ending in ${maskedKey})`);
      
      // Strict sender detection: ignore placeholders and invalid domains
      let emailFrom = settings.smtp_from || settings.company_email || process.env.EMAIL_FROM || 'onboarding@resend.dev';
      
      // Clean the email address from 'Name <email>' format if needed for check
      const pureEmail = emailFrom.includes('<') ? emailFrom.match(/<([^>]+)>/)?.[1] || emailFrom : emailFrom;
      
      if (pureEmail.toLowerCase().includes('acmecorp.com') || pureEmail.toLowerCase().includes('example.com') || !pureEmail.includes('@')) {
        console.warn(`[EMAIL] Placeholder domain detected (${pureEmail}). Forcing 'onboarding@resend.dev'`);
        emailFrom = 'onboarding@resend.dev';
      }

      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: emailFrom.includes('<') ? emailFrom : `Payroll System <${emailFrom}>`,
          to: [to],
          subject: subject || 'Notification',
          html: html || text || '<p>No content provided.</p>',
          text: text || html || 'No content provided.',
          attachments: attachments?.map(a => ({
            filename: a.filename,
            content: a.content.toString('base64')
          })) || []
        }),
      });

      const responseData = await response.json();

      if (response.ok) {
        return responseData;
      } else {
        const errorMsg = responseData.message || 'Unknown Resend error';
        console.error(`[EMAIL] Resend API error:`, responseData);
        
        // Throw specific error for domain issues so the UI can show it
        if (errorMsg.toLowerCase().includes('not verified') || response.status === 403) {
          throw new Error(`Domain Not Verified: Resend cannot send from "${pureEmail}". Please verify your domain in Resend dashboard or use "onboarding@resend.dev" in Settings.`);
        }
        throw new Error(errorMsg);
      }
    } catch (e) {
      console.error(`[EMAIL] Resend operation failed:`, e);
      // Re-throw to be caught by the route handler
      throw e;
    }
  }

  // 2. Fallback to SMTP if configured
  if (settings.smtp_host && settings.smtp_user && settings.smtp_pass) {
    console.log(`[EMAIL] Attempting SMTP fallback to ${to} via ${settings.smtp_host}`);
    const transporter = nodemailer.createTransport({
      host: settings.smtp_host,
      port: parseInt(settings.smtp_port || '587'),
      secure: settings.smtp_port === '465',
      auth: {
        user: settings.smtp_user,
        pass: settings.smtp_pass,
      },
      tls: { rejectUnauthorized: false }
    });

    return transporter.sendMail({
      from: settings.smtp_from || settings.company_email || 'hr@ctint.in',
      to,
      subject,
      html,
      text,
    });
  }

  throw new Error('No working email configuration found. Please check your RESEND_API_KEY or SMTP settings.');
}

const router = Router();

router.post('/email/send', async (req, res) => {
  const { payslipIds, templateId } = req.body;
  if (!Array.isArray(payslipIds) || payslipIds.length === 0) {
    return res.status(400).json({ error: 'Missing payslipIds' });
  }

  const client = createClient();
  await client.connect();

  try {
    let templateContent = null;
    if (templateId) {
      const tRes = await client.query('SELECT content FROM payslip_templates WHERE id = $1', [templateId]);
      if (tRes.rows.length > 0) {
        templateContent = tRes.rows[0].content;
      }
    }
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
      const text = `Hello ${row.employee_name}, your payslip for ${monthNames[row.month - 1]} ${row.year} is ready. Net Salary: ${formatCurrency(row.net_salary)}`;
      const html = buildPayslipHtml(row);
      const pdfBuffer = generatePayslipPdf(row, templateContent);

      try {
        await sendEmail({ 
          to: row.email, 
          subject, 
          html, 
          text,
          attachments: [{ filename: `Payslip_${row.employee_name}_${monthNames[row.month - 1]}.pdf`, content: pdfBuffer }]
        });
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
    const html = buildPayslipHtml(row);
    const pdfBuffer = generatePayslipPdf(row);
    const subject = `Payslip for ${monthNames[row.month - 1]} ${row.year}`;
    const text = `Hello ${row.employee_name}, your payslip for ${monthNames[row.month - 1]} ${row.year} is ready. Net Salary: ${formatCurrency(row.net_salary)}`;
    const now = new Date();

    try {
      await sendEmail({ 
        to: row.email, 
        subject, 
        html, 
        text,
        attachments: [{ filename: `Payslip_${row.employee_name}_${monthNames[row.month - 1]}.pdf`, content: pdfBuffer }]
      });
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
  const { employeeId, email, subject, body, payslipId, groupId } = req.body;
  
  const client = createClient();
  try {
    await client.connect();
  } catch (error) {
    console.error('[DB] Connection failed:', error);
    return res.status(503).json({ error: 'Database connection temporarily unavailable.' });
  }

  try {
    let recipients: { id: string | null; email: string }[] = [];

    if (groupId) {
      const groupRes = await client.query(`
        SELECT e.id, e.email 
        FROM email_group_members gm
        JOIN employees e ON gm.employee_id = e.id
        WHERE gm.group_id = $1
      `, [groupId]);
      recipients = groupRes.rows;
    } else if (email) {
      recipients = [{ id: employeeId || null, email }];
    }

    if (recipients.length === 0) {
      return res.status(400).json({ error: 'No recipients found' });
    }

    let results = { sent: 0, failed: 0 };

    for (const recipient of recipients) {
      let html = body ? `<div style="font-family: sans-serif; line-height: 1.6;">${body.replace(/\n/g, '<br/>')}</div>` : '<p>Hello, please find the document attached.</p>';
      let text = body || 'Hello, please find the document attached.';
      let finalSubject = subject || 'Notification from Payroll';
      let payrollId = null;
      let attachments: any[] = [];

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
          const payslipHtml = `
            <div style="font-family: sans-serif; background-color: #f1f5f9; padding: 20px; border-radius: 10px;">
              <h2 style="color: #1e40af;">Payslip Included</h2>
              <p>Hello ${row.employee_name}, we have attached your payslip for ${monthNames[row.month - 1]} ${row.year} to this email.</p>
            </div>
          `;
          const pdfBuffer = generatePayslipPdf(row);
          
          html = body ? `<div style="margin-bottom: 20px; font-family: sans-serif; line-height: 1.6;">${body.replace(/\n/g, '<br/>')}</div><hr />${payslipHtml}` : payslipHtml;
          text = `${body || ''}\n\n[Payslip PDF Attached]`;
          finalSubject = subject || `Payslip for ${monthNames[row.month - 1]} ${row.year}`;
          payrollId = row.payroll_id;
          
          attachments = [{ filename: `Payslip_${row.employee_name}_${monthNames[row.month - 1]}.pdf`, content: pdfBuffer }];
        }
      }

      const now = new Date();
      try {
        await sendEmail({ to: recipient.email, subject: finalSubject, html, text, attachments });
        await client.query(
          `INSERT INTO email_logs (employee_id, payroll_id, email, subject, status, sent_at) VALUES ($1, $2, $3, $4, $5, $6)`,
          [recipient.id, payrollId, recipient.email, finalSubject, 'sent', now]
        );
        results.sent++;
      } catch (error) {
        const message = String((error as any).message || 'Unknown error');
        await client.query(
          `INSERT INTO email_logs (employee_id, payroll_id, email, subject, status, error_message, sent_at) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [recipient.id, payrollId, recipient.email, finalSubject, 'failed', message, now]
        );
        results.failed++;
      }
    }

    res.json({ success: true, ...results });
  } catch (error) {
    console.error('Error sending manual email:', error);
    res.status(500).json({ error: 'Failed to send manual email' });
  } finally {
    await client.end();
  }
});

// Group Management Routes
router.get('/email/groups', async (req, res) => {
  const client = createClient();
  try {
    await client.connect();
    const result = await client.query(`
      SELECT g.*, 
      (SELECT COUNT(*) FROM email_group_members WHERE group_id = g.id) as member_count
      FROM email_groups g
      ORDER BY g.name ASC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('[GROUPS] Load error:', error);
    res.status(500).json({ error: 'Failed to fetch groups' });
  } finally {
    try { await client.end(); } catch (e) {}
  }
});

router.post('/email/groups', async (req, res) => {
  const { name, description } = req.body;
  const client = createClient();
  await client.connect();
  try {
    const result = await client.query(
      'INSERT INTO email_groups (name, description) VALUES ($1, $2) RETURNING *',
      [name, description]
    );
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create group' });
  } finally {
    await client.end();
  }
});

router.delete('/email/groups/:id', async (req, res) => {
  const client = createClient();
  await client.connect();
  try {
    await client.query('DELETE FROM email_group_members WHERE group_id = $1', [req.params.id]);
    await client.query('DELETE FROM email_groups WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete group' });
  } finally {
    await client.end();
  }
});

router.get('/email/groups/:id/members', async (req, res) => {
  const client = createClient();
  await client.connect();
  try {
    const result = await client.query('SELECT employee_id FROM email_group_members WHERE group_id = $1', [req.params.id]);
    res.json(result.rows.map(r => r.employee_id));
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch group members' });
  } finally {
    await client.end();
  }
});

router.post('/email/groups/:id/members', async (req, res) => {
  const { employeeId, action } = req.body;
  const client = createClient();
  await client.connect();
  try {
    if (action === 'remove') {
      await client.query('DELETE FROM email_group_members WHERE group_id = $1 AND employee_id = $2', [req.params.id, employeeId]);
    } else {
      await client.query('INSERT INTO email_group_members (group_id, employee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.params.id, employeeId]);
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update group members' });
  } finally {
    await client.end();
  }
});

export { router as emailRouter };