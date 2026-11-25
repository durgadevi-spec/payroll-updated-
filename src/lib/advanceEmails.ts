import { sendEmail } from '../routes/emailRoutes';

// Email notifications for the advance workflow.
//  - request raised  -> admins (Settings > Company > "Advance Approver Emails", key advance_admin_emails)
//  - approved/rejected -> the employee who asked
// Every function swallows its own errors: a mail problem must never fail the advance action.

const esc = (v: any) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const inr = (n: any) => `₹${Number(n || 0).toLocaleString('en-IN')}`;
const monthLabel = (ym?: string | null) => {
  const m = /^(\d{4})-(\d{2})/.exec(String(ym || ''));
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
};

function wrap(title: string, color: string, rows: [string, string][], footer: string) {
  const body = rows.map(([k, v]) => `<tr><td style="padding:6px 12px;color:#64748b;font-size:13px">${esc(k)}</td><td style="padding:6px 12px;color:#0f172a;font-size:13px;font-weight:600">${esc(v)}</td></tr>`).join('');
  return `<div style="font-family:sans-serif;padding:20px;color:#334155"><h2 style="color:${color};margin-top:0">${esc(title)}</h2>
    <table style="border-collapse:collapse;background:#f1f5f9;border-radius:8px">${body}</table>
    <p style="margin-top:16px">${footer}</p><hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0">
    <p style="font-size:12px;color:#94a3b8">This is an automated notification from the Payroll System.</p></div>`;
}

async function loadAdvance(client: any, advanceId: string) {
  const r = await client.query(
    `SELECT a.*, TO_CHAR(a.deduction_start_month, 'YYYY-MM') AS start_ym, e.name AS employee_name, e.email AS employee_email
     FROM advances a JOIN employees e ON e.id = a.employee_id WHERE a.id = $1`, [advanceId]);
  return r.rows[0];
}

export async function notifyAdvanceRaised(client: any, advanceId: string) {
  try {
    const adv = await loadAdvance(client, advanceId);
    if (!adv) return;
    const s = await client.query(`SELECT value FROM settings WHERE key = 'advance_admin_emails'`);
    const admins = String(s.rows[0]?.value || '').split(',').map((x: string) => x.trim()).filter(Boolean);
    if (admins.length === 0) { console.warn('[ADVANCE-EMAIL] No Advance Approver Emails set in Settings; request notification skipped'); return; }

    const rows: [string, string][] = [
      ['Employee', adv.employee_name], ['Type', adv.advance_type || 'Salary Advance'], ['Amount', inr(adv.amount)],
      ['Date needed', String(adv.date).slice(0, 10)],
      ['Repayment', adv.repayment_type === 'One-time' ? 'One-time deduction' : `${adv.no_of_installments || 1} installment(s)`],
    ];
    const start = monthLabel(adv.start_ym);
    if (start) rows.push(['Start deduction from', start]);
    if (adv.reason) rows.push(['Reason', adv.reason]);
    const subject = `New Advance Request - ${adv.employee_name} (${inr(adv.amount)})`;
    const html = wrap('New Advance Request', '#1e40af', rows, 'Please open <b>Advance Management</b> to approve or reject this request.');
    const text = rows.map(([k, v]) => `${k}: ${v}`).join('\n') + '\n\nPlease open Advance Management to approve or reject.';
    for (const to of admins) {
      try { await sendEmail({ to, subject, html, text }); }
      catch (e) { console.error('[ADVANCE-EMAIL] Failed for admin', to, e instanceof Error ? e.message : e); }
    }
  } catch (e) { console.error('[ADVANCE-EMAIL] notifyAdvanceRaised failed:', e); }
}

export async function notifyAdvanceDecision(client: any, advanceId: string, decision: 'approved' | 'rejected') {
  try {
    const adv = await loadAdvance(client, advanceId);
    if (!adv) return;
    if (!adv.employee_email) { console.warn('[ADVANCE-EMAIL] Employee has no email; decision notification skipped'); return; }

    const rows: [string, string][] = [['Type', adv.advance_type || 'Salary Advance'], ['Amount', inr(adv.amount)]];
    let subject: string, html: string, text: string;
    if (decision === 'approved') {
      if ((adv.settlement_type || 'Payroll') === 'Payroll') {
        rows.push(['Deduction per month', inr(adv.installment_amount)]);
        rows.push(['Deduction starts', monthLabel(adv.start_ym) || 'From the next payroll']);
      }
      subject = `Advance Approved - ${inr(adv.amount)}`;
      html = wrap('Your advance request is approved', '#15803d', rows, `Dear ${esc(adv.employee_name)}, your advance request has been approved and disbursed.`);
      text = `Dear ${adv.employee_name},\n\nYour advance request has been approved.\n` + rows.map(([k, v]) => `${k}: ${v}`).join('\n');
    } else {
      if (adv.rejection_reason) rows.push(['Reason', adv.rejection_reason]);
      subject = `Advance Request Rejected - ${inr(adv.amount)}`;
      html = wrap('Your advance request was rejected', '#b91c1c', rows, `Dear ${esc(adv.employee_name)}, your advance request could not be approved. Please contact HR or Finance for details.`);
      text = `Dear ${adv.employee_name},\n\nYour advance request has been rejected.\n` + rows.map(([k, v]) => `${k}: ${v}`).join('\n');
    }
    await sendEmail({ to: adv.employee_email, subject, html, text });
  } catch (e) { console.error('[ADVANCE-EMAIL] notifyAdvanceDecision failed:', e instanceof Error ? e.message : e); }
}