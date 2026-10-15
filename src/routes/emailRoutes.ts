import { Router } from 'express';
import { Client } from 'pg';
import dotenv from 'dotenv';
import nodemailer from 'nodemailer';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { PAGE_WIDTH_PX, visualItemText, type VisualPayslipData } from '../lib/visualTemplate';
import { DEFAULT_PAYSLIP_TEMPLATE } from '../lib/defaultTemplate';
import { numberToWords } from '../lib/numberToWords';
import { getSalaryBreakdown } from '../lib/salaryBreakdown';

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
const fullMonthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * Fetches email settings from the database
 */
async function getEmailSettings() {
  const client = createClient();
  await client.connect();
  try {
    const res = await client.query("SELECT key, value FROM settings WHERE key IN ('smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_from', 'company_email')");
    const settings: Record<string, string> = {};
    res.rows.forEach((row: any) => { settings[row.key] = row.value; });
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


/** Adds a data-URL image to the PDF; never throws (a bad image must not block sending). */
function safeAddImage(doc: jsPDF, dataUrl: string | undefined, x: number, y: number, w: number, h: number, opts?: { fit?: boolean; opacity?: number }) {
  if (!dataUrl || !dataUrl.startsWith('data:image/')) return false;
  try {
    const fmt = /^data:image\/png/i.test(dataUrl) ? 'PNG' : 'JPEG';
    let dx = x, dy = y, dw = w, dh = h;
    if (opts?.fit) {
      const props = doc.getImageProperties(dataUrl);
      const ratio = Math.min(w / props.width, h / props.height);
      dw = props.width * ratio;
      dh = props.height * ratio;
      dx = x + (w - dw) / 2;
      dy = y + (h - dh) / 2;
    }
    const withOpacity = opts?.opacity !== undefined && opts.opacity < 1;
    if (withOpacity) {
      doc.saveGraphicsState();
      doc.setGState(new (doc as any).GState({ opacity: opts!.opacity }));
    }
    doc.addImage(dataUrl, fmt, dx, dy, dw, dh);
    if (withOpacity) doc.restoreGraphicsState();
    return true;
  } catch (err) {
    console.warn('[PDF] Could not embed image:', (err as Error).message);
    return false;
  }
}

/**
 * Full-page "image template": the uploaded image fills the page (at its own shape, never stretched),
 * then cover boxes, text boxes and payroll values are drawn on top. Mirrors VisualPayslipPage.tsx.
 */
export function renderVisualTemplate(row: any, templateContent: any) {
  const cfg = templateContent.visualConfig;
  const aspect = Number(cfg.aspectRatio) > 0 ? Number(cfg.aspectRatio) : 297 / 210;
  const pageWidth = 210;
  const pageHeight = 210 * aspect;
  const doc = new jsPDF({
    unit: 'mm',
    format: [Math.min(pageWidth, pageHeight), Math.max(pageWidth, pageHeight)],
    orientation: pageHeight >= pageWidth ? 'portrait' : 'landscape',
  });
  safeAddImage(doc, cfg.backgroundImage, 0, 0, pageWidth, pageHeight);

  const grossSalary = Number(row.monthly_salary ?? row.basic_salary ?? 0);
  const salaryBreakdown = getSalaryBreakdown(grossSalary);
  const data: VisualPayslipData = {
    employee_name: row.employee_name,
    employee_code: String(row.employee_code || row.employee_id || ''),
    designation: row.designation,
    department: row.department,
    site_location: row.site_location,
    basic_salary: salaryBreakdown.basic_salary,
    hra: salaryBreakdown.hra,
    conveyance: salaryBreakdown.conveyance,
    medical: salaryBreakdown.medical,
    special_allowance: salaryBreakdown.special_allowance,
    pan_number: row.pan_number,
    bank_account: row.bank_account,
    month: row.month,
    year: row.year,
    working_days: row.working_days,
    calculation_days: row.calculation_days,
    monthly_salary: grossSalary,
    sunday_work_days: row.sunday_work_days,
    bonus: row.bonus,
    previous_month_balance: row.previous_month_balance,
    leave_deduction: row.leave_deduction,
    timesheet_deduction: row.timesheet_deduction,
    missing_punch_deduction: row.missing_punch_deduction,
    pf_deduction: row.pf_deduction,
    esi_deduction: row.esi_deduction,
    tax_deduction: row.tax_deduction,
    loan_deduction: row.loan_deduction,
    advance_deduction: row.advance_deduction,
    net_salary: row.net_salary,
  };

  const rgb = (hex: string, fallback: [number, number, number]): [number, number, number] =>
    /^#[0-9a-f]{6}$/i.test(hex || '') ? [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)] : fallback;

  const items: any[] = cfg.fields || [];
  const pad = 0.5; // mm, matches the 2px padding used on screen
  const mmPerPx = pageWidth / PAGE_WIDTH_PX;

  // covers first so they never hide values/text drawn later
  const ordered = [...items.filter(f => f.kind === 'cover'), ...items.filter(f => f.kind !== 'cover')];
  for (const f of ordered) {
    const bx = (f.x / 100) * pageWidth;
    const by = (f.y / 100) * pageHeight;
    const bw = f.width != null ? (f.width / 100) * pageWidth : undefined;
    const bh = f.height != null ? (f.height / 100) * pageHeight : undefined;

    if (f.bgColor && bw != null && bh != null) {
      const [r, g, b] = rgb(f.bgColor, [255, 255, 255]);
      doc.setFillColor(r, g, b);
      doc.rect(bx, by, bw, bh, 'F');
    }
    if (f.kind === 'cover') continue;

    // the built-in PDF font has no rupee glyph
    const text = visualItemText(f, data, 'Rs. ').replace(/₹/g, 'Rs.');
    if (!text) continue;

    const [tr, tg, tb] = rgb(f.color, [0, 0, 0]);
    doc.setTextColor(tr, tg, tb);
    doc.setFont('helvetica', ['bold', 'black', 'medium'].includes(f.fontWeight) ? 'bold' : 'normal');
    let fontPx = f.fontSize || 12;
    doc.setFontSize(fontPx * mmPerPx * 2.8346); // px on the 800px page -> pt
    if (bw != null) {
      const avail = bw - pad * 2;
      const w = doc.getTextWidth(text);
      if (w > avail && avail > 0) {
        fontPx = Math.max(fontPx * 0.5, fontPx * (avail / w));
        doc.setFontSize(fontPx * mmPerPx * 2.8346);
      }
    }

    const align = f.align || 'left';
    let tx = bx + pad;
    if (bw != null && align === 'right') tx = bx + bw - pad;
    else if (bw != null && align === 'center') tx = bx + bw / 2;
    if (bh != null) {
      doc.text(text, tx, by + bh / 2, { align, baseline: 'middle' });
    } else {
      doc.text(text, tx, by, { align, baseline: 'top' });
    }
  }
  return Buffer.from(doc.output('arraybuffer'));
}

function generatePayslipPdf(row: any, templateContent?: any) {
  const doc = new jsPDF();
  const basicSalary = Number(row.monthly_salary ?? row.basic_salary ?? 0);
  const salaryBreakdown = getSalaryBreakdown(basicSalary);
  const prevBalance = Number(row.previous_month_balance || 0);
  const pageWidth = doc.internal.pageSize.getWidth();

  if (templateContent?.type === 'visual' && templateContent?.visualConfig?.backgroundImage) {
    return renderVisualTemplate(row, templateContent);
  }

  // No template chosen -> built-in default template (Concept Trunk payslip format)
  const tpl = templateContent?.sections ? templateContent : DEFAULT_PAYSLIP_TEMPLATE;
  const header = tpl.header || DEFAULT_PAYSLIP_TEMPLATE.header;
  const money = (v: number) => (!Number(v) ? '00.00' : formatCurrency(Number(v), true));
  const fmtDate = (d: any) => {
    if (!d) return '—';
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return '—';
    return `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}/${dt.getFullYear()}`;
  };
  const GRID = [120, 120, 120] as [number, number, number];
  const HEAD_FILL = [217, 217, 217] as [number, number, number];
  const base = { fontSize: 8, cellPadding: 2, lineColor: GRID, lineWidth: 0.2, textColor: [0, 0, 0] as [number, number, number], font: 'times' };

  // 0. Background image (template header setting), drawn first so everything sits on top
  if (header.backgroundImage) {
    const op = Math.min(100, Math.max(0, Number(header.backgroundOpacity ?? 40))) / 100;
    safeAddImage(doc, header.backgroundImage, 0, 0, pageWidth, doc.internal.pageSize.getHeight(), { opacity: op });
  }

  // 1. Logo box (top left)
  if (header.showLogo && header.logoUrl && safeAddImage(doc, header.logoUrl, 14, 10, 26, 26, { fit: true })) {
    // uploaded logo image drawn
  } else if (header.showLogo) {
    doc.setFillColor(0, 0, 0);
    doc.rect(14, 10, 26, 26, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.text(header.logoText || 'CT', 27, 25, { align: 'center' });
  }

  // 2. Company name + address
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(24);
  doc.setFont('helvetica', 'normal');
  doc.text(String(header.title || '').toUpperCase(), 46, 24);
  doc.setFontSize(8);
  doc.setFont('times', 'normal');
  doc.setTextColor(120, 120, 120);
  doc.text(header.address || '', 46, 40);

  // 3. Title
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'normal');
  doc.text(`PAY SLIP — ${fullMonthNames[row.month - 1]} ${row.year}`, pageWidth / 2, 54, { align: 'center' });

  let y = 60;

  // 4. Employee details (two label/value pairs per row), driven by the template fields
  if (tpl.sections.employeeDetails?.enabled !== false) {
    const valueFor = (key: string): string => {
      switch (key) {
        case 'employee_code': return row.employee_code || row.employee_id?.substring(0, 8)?.toUpperCase() || '—';
        case 'employee_name': return row.employee_name || '—';
        case 'designation': return row.designation || '—';
        case 'department': return row.department || '—';
        case 'site':
        case 'site_location': return row.site_location || row.site || row.location || '—';
        case 'joining_date': return fmtDate(row.joining_date);
        case 'pan': return row.pan || row.pan_number || '—';
        case 'bank_account': return row.bank_account ? `${row.bank_name ? row.bank_name + ' - ' : ''}${row.bank_account}` : '—';
        case 'pay_mode': return 'NEFT / Bank Transfer';
        case 'working_days': return String(row.working_days ?? 0);
        default: return '—';
      }
    };
    const fields: { label: string; key: string }[] = tpl.sections.employeeDetails.fields || [];
    const body: any[][] = [];
    for (let i = 0; i < fields.length; i += 2) {
      const bold = i === 0 ? { fontStyle: 'bold', font: 'helvetica' } : {};
      const l = fields[i];
      const r = fields[i + 1];
      body.push([
        { content: l.label, styles: bold },
        { content: valueFor(l.key), styles: bold },
        { content: r ? r.label : '', styles: bold },
        { content: r ? valueFor(r.key) : '', styles: bold },
      ]);
    }
    autoTable(doc, {
      startY: y,
      margin: { left: 22, right: 22 },
      body,
      theme: 'grid',
      styles: base,
      columnStyles: { 0: { cellWidth: 30 }, 1: { cellWidth: 52 }, 2: { cellWidth: 30 }, 3: { cellWidth: 'auto' } },
    });
    y = (doc as any).lastAutoTable.finalY + 10;
  }

  if (tpl.sections.attendanceDetails?.enabled) {
    const workingDays = Number(row.working_days || 0);
    const exceptionDates = Array.isArray(row.missing_punch_exception_dates)
      ? row.missing_punch_exception_dates
      : [];
    const deductibleMissingPunchDays = Math.max(
      0,
      Number(row.missing_punches || 0) - exceptionDates.length,
    );
    const lopDays = Number(row.unpaid_leaves || 0) + deductibleMissingPunchDays;
    const presentDays = Math.max(0, workingDays - lopDays);
    const formatDays = (days: number) => days.toLocaleString('en-IN', { maximumFractionDigits: 2 });
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(tpl.sections.attendanceDetails.title || '2. Attendance Details', 22, y);
    autoTable(doc, {
      startY: y + 2,
      margin: { left: 22, right: 22 },
      body: [[
        { content: 'No. of Days', styles: { fontStyle: 'bold' } },
        formatDays(workingDays),
        { content: 'No. of Days Present', styles: { fontStyle: 'bold' } },
        formatDays(presentDays),
        { content: 'LOP Days', styles: { fontStyle: 'bold' } },
        formatDays(lopDays),
      ]],
      theme: 'grid',
      styles: base,
      columnStyles: { 0: { cellWidth: 30 }, 1: { cellWidth: 25 }, 2: { cellWidth: 30 }, 3: { cellWidth: 25 }, 4: { cellWidth: 25 }, 5: { cellWidth: 'auto' } },
    });
    y = (doc as any).lastAutoTable.finalY + 10;
  }

  // 5. Earnings & Deductions
  const perDaySalary = (basicSalary || 0) / (row.working_days || 26);
  const sundayEarnings = Math.round(perDaySalary * (row.sunday_work_days || 0) * 100) / 100;

  const earnValue = (key: string, label = '') => {
    const isLegacySpecialAllowance = key === 'bonus' && /special allowance/i.test(label);
    if (key === 'basic_salary') return salaryBreakdown.basic_salary;
    if (key === 'monthly_salary') return basicSalary || 0;
    if (key === 'sunday_work_earnings') return sundayEarnings || 0;
    if (key === 'bonus' && !isLegacySpecialAllowance) return Number(row.bonus || 0);
    if (key === 'previous_month_balance') return prevBalance;
    if (key === 'hra') return salaryBreakdown.hra;
    if (key === 'conveyance') return salaryBreakdown.conveyance;
    if (key === 'medical') return salaryBreakdown.medical;
    if (key === 'special_allowance' || isLegacySpecialAllowance) return salaryBreakdown.special_allowance;
    if (key === 'ot_allowance') return Number(row.ot_allowance || 0);
    return 0;
  };
  const totalDed = Number(row.leave_deduction || 0) + Number(row.timesheet_deduction || 0) + Number(row.missing_punch_deduction || 0) + Number(row.pf_deduction || 0) + Number(row.esi_deduction || 0) + Number(row.tax_deduction || 0) + Number(row.loan_deduction || 0) + Number(row.advance_deduction || 0);
  const dedValue = (key: string) => {
    if (key === 'leave_deduction' || key === 'lop') return Number(row.leave_deduction || 0) + Number(row.timesheet_deduction || 0) + Number(row.missing_punch_deduction || 0);
    if (key === 'pf_deduction' || key === 'pf') return Number(row.pf_deduction || 0);
    if (key === 'esi_deduction' || key === 'esi') return Number(row.esi_deduction || 0);
    if (key === 'tax_deduction' || key === 'tax') return Number(row.tax_deduction || 0);
    if (key === 'loan_deduction' || key === 'loan') return Number(row.loan_deduction || 0);
    if (key === 'advance_deduction' || key === 'advance') return Number(row.advance_deduction || 0);
    if (key === 'total_deductions') return totalDed;
    return 0;
  };

  const earnRows = (tpl.sections.earnings?.rows || []).map((r: any) => ({ label: r.label, key: r.key, val: earnValue(r.key, r.label), hide: !!r.hideIfZero }));
  if (Number(row.bonus || 0) !== 0 && !earnRows.some((r: any) => r.key === 'bonus' && !/special allowance/i.test(r.label))) {
    earnRows.push({ label: 'Bonus', key: 'bonus', val: Number(row.bonus || 0), hide: true });
  }
  // Previous Month Balance always surfaces when non-zero, even on older templates without that row
  if (prevBalance > 0 && !earnRows.some((r: any) => r.key === 'previous_month_balance')) {
    earnRows.push({ label: 'Previous Month Balance', key: 'previous_month_balance', val: prevBalance, hide: false });
  }
  const earnShown = earnRows.filter((r: any) => !r.hide || r.val !== 0);
  const grossEarnings = earnRows.reduce((sum: number, r: any) => sum + Number(r.val || 0), 0);
  const dedShown = (tpl.sections.deductions?.rows || [])
    .map((r: any) => ({ label: r.label, val: dedValue(r.key), hide: !!r.hideIfZero }))
    .filter((r: any) => !r.hide || r.val !== 0);

  const left: string[][] = [...earnShown.map((r: any) => [r.label, money(r.val)]), ['Gross Earnings', money(grossEarnings)]];
  const rowCount = Math.max(left.length, dedShown.length);
  const edBody: any[][] = [];
  for (let i = 0; i < rowCount; i++) {
    const l = left[i];
    const d = dedShown[i];
    edBody.push([
      { content: l ? l[0] : '', styles: l ? {} : { lineWidth: 0 } },
      { content: l ? l[1] : '', styles: l ? { halign: 'right' } : { lineWidth: 0 } },
      { content: d ? d.label : '', styles: d ? {} : { lineWidth: 0 } },
      { content: d ? money(d.val) : '', styles: d ? { halign: 'right' } : { lineWidth: 0 } },
    ]);
  }
  const headStyle = { fillColor: HEAD_FILL, textColor: [0, 0, 0] as [number, number, number], font: 'helvetica', fontStyle: 'bold' as const, lineColor: GRID, lineWidth: 0.2 };
  autoTable(doc, {
    startY: y,
    margin: { left: 14, right: 14 },
    head: [[
      { content: tpl.sections.earnings?.title || 'EARNINGS', styles: headStyle },
      { content: 'Amount (INR)', styles: headStyle },
      { content: tpl.sections.deductions?.title || 'DEDUCTIONS', styles: headStyle },
      { content: 'Amount (INR)', styles: headStyle },
    ]],
    body: edBody,
    theme: 'grid',
    styles: base,
    columnStyles: { 0: { cellWidth: 52 }, 1: { cellWidth: 40 }, 2: { cellWidth: 50 }, 3: { cellWidth: 'auto' } },
  });
  y = (doc as any).lastAutoTable.finalY + 10;

  // 6. Net pay (+ in words)
  const netPay = Number(row.net_salary || 0);
  const netWords = `Rupees ${numberToWords(Math.round(netPay)).replace(/\s*Rupees$/, '')} only`;
  const netBody: any[][] = [[
    { content: tpl.sections.summary?.title || 'Net Pay (Gross - Deductions)', styles: { fontStyle: 'bold', font: 'helvetica', fontSize: 10, fillColor: [242, 242, 242] } },
    { content: money(netPay), styles: { fontStyle: 'bold', font: 'helvetica', fontSize: 10, halign: 'right', fillColor: [242, 242, 242] } },
  ]];
  if (tpl.sections.summary?.showNetPayInWords !== false) {
    netBody.push(['Net Pay(in words)', netWords]);
  }
  autoTable(doc, {
    startY: y,
    margin: { left: 14, right: 14 },
    body: netBody,
    theme: 'grid',
    styles: base,
    columnStyles: { 0: { cellWidth: 100 }, 1: { cellWidth: 'auto' } },
  });
  y = (doc as any).lastAutoTable.finalY + 10;

  // 7. Leave balances (only when balance data is present on the row)
  const lbs: any[] = Array.isArray(row.leave_balances) ? row.leave_balances : [];
  if (tpl.sections.leaveBalances?.enabled && lbs.length) {
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(12);
    doc.text(`${tpl.sections.leaveBalances.title || 'Leave Balances'} (as on ${fullMonthNames[row.month - 1]} ${row.year})`, pageWidth / 2, y, { align: 'center' });
    autoTable(doc, {
      startY: y + 3,
      margin: { left: 28, right: 28 },
      head: [['Leave Type', 'Opening', 'Allotted', 'Avail.', 'Encash.', 'Adjust.', 'Closing'].map(h => ({ content: h, styles: headStyle }))],
      body: lbs.map(lb => [lb.type || lb.leave_type, lb.opening ?? 0, lb.allotted ?? 0, lb.availed ?? lb.avail ?? 0, lb.encashed ?? lb.encash ?? 0, lb.adjusted ?? lb.adjust ?? 0, lb.closing ?? 0]),
      theme: 'grid',
      styles: { ...base, halign: 'center' },
    });
    y = (doc as any).lastAutoTable.finalY + 6;
  }

  // 8. Reimbursements, remarks, prepared-by, generated-on
  const footer = tpl.sections.footer || {};
  doc.setTextColor(0, 0, 0);
  if (footer.reimbursementsNote) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text('Reimbursements -', 14, y + 2);
    const w = doc.getTextWidth('Reimbursements - ');
    doc.setFont('times', 'normal');
    doc.text(footer.reimbursementsNote, 14 + w, y + 2);
    y += 12;
  }
  doc.setFont('times', 'normal');
  doc.setFontSize(13);
  doc.text('Remarks:', 14, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  const remarks: string[] = footer.remarks || [];
  remarks.forEach((remark: string, index: number) => {
    doc.text(`- ${remark}`, 16, y + 5 + index * 3.8);
  });
  y += 5 + remarks.length * 3.8 + 6;
  doc.setFont('times', 'normal');
  doc.setFontSize(7.5);
  if (footer.preparedBy) {
    doc.text(`Prepared By: ${footer.preparedBy}`, 14, y);
    y += 6;
  }
  if (footer.showGeneratedDate !== false) {
    doc.text(`Generated on: ${fmtDate(new Date())}`, 14, y);
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
             e.employee_code,
             e.joining_date,
             e.email,
             e.designation,
             e.department,
             e.site_location,
             e.bank_name,
             e.bank_account,
             e.pan_number,
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
             e.employee_code,
             e.joining_date,
             e.designation,
             e.department,
             e.site_location,
             e.bank_name,
             e.bank_account,
             e.pan_number,
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
          SELECT e.name AS employee_name, e.employee_code, e.joining_date, e.designation, e.department, e.bank_account, pr.month, pr.year, pi.*
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
router.get('/email/groups', async (_req, res) => {
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
    try { await client.end(); } catch (e) { }
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
    res.json(result.rows.map((r: any) => r.employee_id));
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