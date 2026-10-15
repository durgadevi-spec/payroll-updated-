import { PayslipFull } from '../../types';
import { PayslipTemplateContent } from '../../types/payslip';
import { VisualPayslipPage, payslipToVisualData } from './VisualPayslipPage';
import { getMonthName } from '../../lib/payrollCalculator';
import { numberToWords } from '../../lib/numberToWords';
import { DEFAULT_PAYSLIP_TEMPLATE } from '../../lib/defaultTemplate';
import { getSalaryBreakdown } from '../../lib/salaryBreakdown';
import React, { useState, useEffect } from 'react';
import { Plus, Trash2 } from 'lucide-react';

interface Props {
  payslip: PayslipFull;
  templateContent?: PayslipTemplateContent;
  editable?: boolean;
  onUpdateValue?: (key: string, value: number) => void;
  /** Send Payslips dialog: edit the Leave Balances table (saved on the payroll item). */
  onUpdateLeaveBalances?: (rows: LeaveBalanceRow[]) => void;
  onUpdateLabel?: (section: 'earnings' | 'deductions', index: number, label: string) => void;
  onRemoveRow?: (section: 'earnings' | 'deductions', index: number) => void;
  onAddRow?: (section: 'earnings' | 'deductions') => void;
  /** Opt-in: inline-edit amounts and labels (no add/remove-row controls). Used by the Send Payslips dialog. */
  inlineEdit?: boolean;
  /** Inline edit of the company header (template-level). */
  onUpdateHeader?: (field: 'title' | 'address', value: string) => void;
  /** Inline edit of employee detail cells (saved to the employee record). */
  onUpdateEmployee?: (field: 'name' | 'designation' | 'department' | 'bank_account', value: string) => void;
  /** DOM id for the root element, so PDF download can find the payslip to capture. */
  domId?: string;
}

// Row keys whose amount maps to a real payroll_items column and can be edited inline.
export const INLINE_EDITABLE_KEYS = new Set([
  'monthly_salary', 'bonus', 'previous_month_balance',
  'hra', 'conveyance', 'medical', 'ot_allowance', 'sunday_work_earnings',
  'lop', 'leave_deduction', 'pf', 'pf_deduction', 'esi', 'esi_deduction',
  'tax', 'tax_deduction', 'loan', 'loan_deduction', 'advance', 'advance_deduction',
]);

function InlineText({ value, onCommit, className = '' }: { value: string; onCommit: (v: string) => void; className?: string }) {
  const [text, setText] = useState(value);
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setText(value); }, [value, focused]);
  const commit = () => {
    setFocused(false);
    if (text !== value) onCommit(text);
  };
  return (
    <input
      type="text"
      value={text}
      onFocus={() => setFocused(true)}
      onChange={(ev) => setText(ev.target.value)}
      onBlur={commit}
      onKeyDown={(ev) => { if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur(); }}
      className={`w-full bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-500 ${className}`}
    />
  );
}

function InlineAmount({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  const [text, setText] = useState(String(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setText(String(value)); }, [value, focused]);
  const commit = () => {
    setFocused(false);
    const n = parseFloat(text);
    if (isNaN(n) || n < 0) { setText(String(value)); return; }
    if (n !== value) onCommit(Math.round(n * 100) / 100);
  };
  return (
    <input
      type="number"
      min={0}
      step="0.01"
      value={text}
      onFocus={() => setFocused(true)}
      onChange={(ev) => setText(ev.target.value)}
      onBlur={commit}
      onKeyDown={(ev) => { if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur(); }}
      className="w-28 text-right text-[11px] font-medium bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
    />
  );
}

export interface LeaveBalanceRow {
  type: string;
  opening: number;
  allotted: number;
  availed: number;
  encashed: number;
  adjusted: number;
  closing: number;
}

function InlineNumber({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  const [text, setText] = useState(String(value ?? 0));
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setText(String(value ?? 0)); }, [value, focused]);
  const commit = () => {
    setFocused(false);
    const n = parseFloat(text);
    if (isNaN(n)) { setText(String(value ?? 0)); return; }
    if (n !== value) onCommit(Math.round(n * 100) / 100);
  };
  return (
    <input
      type="number"
      step="0.5"
      value={text}
      onFocus={() => setFocused(true)}
      onChange={(ev) => setText(ev.target.value)}
      onBlur={commit}
      onKeyDown={(ev) => { if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur(); }}
      className="w-16 text-center text-[11px] bg-blue-50 border border-blue-200 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
    />
  );
}

interface PayslipRow {
  label: string;
  value: number;
  key?: string;
  hideIfZero?: boolean;
  isTotal?: boolean;
}

// Amount format used on the payslip: 8,500.00 (zero shows as 00.00)
const fmt = (n: number) =>
  !n ? '00.00' : Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtDate = (d?: string | Date | null) => {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '—';
  const dd = String(dt.getDate()).padStart(2, '0');
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${dt.getFullYear()}`;
};

export function PayslipDocument({ payslip, templateContent, editable, onUpdateValue, onUpdateLeaveBalances, onUpdateLabel, onRemoveRow, onAddRow, inlineEdit, onUpdateHeader, onUpdateEmployee, domId }: Props) {
  const item = payslip.payroll_item;
  const emp = payslip.employee;
  const pal = payslip.payroll;

  if (!item || !emp) return null;

  // No template selected -> use the built-in default template
  const tpl: PayslipTemplateContent = templateContent || DEFAULT_PAYSLIP_TEMPLATE;
  const header = tpl.header;
  const editing = !!(editable || inlineEdit);

  const perDaySalary = (item.monthly_salary || 0) / (item.working_days || 30);
  const sundayEarnings = Math.round(perDaySalary * (item.sunday_work_days || 0) * 100) / 100;
  const itemAny = item as any;
  const salaryBreakdown = getSalaryBreakdown(item.monthly_salary || 0);

  const earnings: PayslipRow[] = tpl.sections.earnings.rows.map(row => {
    let value = 0;
    const isLegacySpecialAllowance = row.key === 'bonus' && /special allowance/i.test(row.label);
    if (row.key === 'monthly_salary') value = item.monthly_salary || 0;
    else if (row.key === 'basic_salary') value = salaryBreakdown.basic_salary;
    else if (row.key === 'sunday_work_earnings') value = sundayEarnings;
    else if (row.key === 'bonus' && !isLegacySpecialAllowance) value = item.bonus || 0;
    else if (row.key === 'previous_month_balance') value = itemAny.previous_month_balance || 0;
    else if (row.key === 'hra') value = salaryBreakdown.hra;
    else if (row.key === 'conveyance') value = salaryBreakdown.conveyance;
    else if (row.key === 'medical') value = salaryBreakdown.medical;
    else if (row.key === 'special_allowance' || isLegacySpecialAllowance) value = salaryBreakdown.special_allowance;
    else if (row.key === 'ot_allowance') value = Number(itemAny.ot_allowance || 0);
    return { label: row.label, value, hideIfZero: row.hideIfZero, key: row.key === 'basic_salary' || isLegacySpecialAllowance ? undefined : row.key };
  });

  const hasBonusRow = earnings.some(e => e.key === 'bonus');
  if (!hasBonusRow && Number(item.bonus || 0) !== 0) {
    earnings.push({ label: 'Bonus', value: Number(item.bonus || 0), key: 'bonus', hideIfZero: true });
  }

  // Previous Month Balance is a manual, per-employee, per-month carry-forward
  // amount, so it won't exist as a row on templates saved before this feature
  // existed. Always surface it as its own earnings line whenever it's
  // non-zero, in addition to whatever the template already defines, so it's
  // never silently missing from a payslip that actually has a balance.
  const hasPreviousMonthBalanceRow = earnings.some((e: { key?: string }) => e.key === 'previous_month_balance');
  if (!hasPreviousMonthBalanceRow && (itemAny.previous_month_balance || 0) > 0) {
    earnings.push({ label: 'Previous Month Balance', value: itemAny.previous_month_balance || 0, key: 'previous_month_balance' });
  }

  const deductions: PayslipRow[] = tpl.sections.deductions.rows.map(row => {
    let value = 0;
    if (row.key === 'lop' || row.key === 'leave_deduction') {
      value = (item.leave_deduction || 0) + (item.timesheet_deduction || 0) + Number(itemAny.missing_punch_deduction || 0);
    }
    else if (row.key === 'pf' || row.key === 'pf_deduction') value = item.pf_deduction;
    else if (row.key === 'esi' || row.key === 'esi_deduction') value = item.esi_deduction;
    else if (row.key === 'tax' || row.key === 'tax_deduction') value = item.tax_deduction;
    else if (row.key === 'loan' || row.key === 'loan_deduction') value = item.loan_deduction;
    else if (row.key === 'advance' || row.key === 'advance_deduction') value = item.advance_deduction || 0;
    else if (row.key === 'total_deductions') value = (item.leave_deduction || 0) + (item.timesheet_deduction || 0) + Number(itemAny.missing_punch_deduction || 0) + (item.pf_deduction || 0) + (item.esi_deduction || 0) + (item.tax_deduction || 0) + (item.loan_deduction || 0) + (item.advance_deduction || 0);
    return { label: row.label, value, key: row.key, hideIfZero: row.hideIfZero, isTotal: row.isTotal };
  });

  const grossEarnings = earnings.reduce((sum, e) => sum + (Number(e.value) || 0), 0);

  if (templateContent?.type === 'visual' && templateContent.visualConfig?.backgroundImage) {
    return (
      <div id={domId} style={{ width: '800px' }}>
        <VisualPayslipPage config={templateContent.visualConfig} data={payslipToVisualData(payslip)} />
      </div>
    );
  }

  // ---- Default (structured) layout: matches the Concept Trunk payslip format ----
  const sans = 'Arial, Helvetica, sans-serif';
  const serif = '"Times New Roman", Times, serif';
  const border = 'border border-neutral-500';
  const monthLabel = pal ? `${getMonthName(pal.month)} ${pal.year}` : '';
  const empAny = emp as any;

  // Employee detail values by template field key
  const detailValue = (key: string): React.ReactNode => {
    switch (key) {
      case 'employee_code': return empAny.employee_code || emp.id?.substring(0, 8)?.toUpperCase() || '—';
      case 'employee_name':
        return inlineEdit && onUpdateEmployee ? <InlineText value={emp.name || ''} onCommit={(v) => onUpdateEmployee('name', v)} className="text-xs" /> : (emp.name || '—');
      case 'designation':
        return inlineEdit && onUpdateEmployee ? <InlineText value={emp.designation || ''} onCommit={(v) => onUpdateEmployee('designation', v)} className="text-xs" /> : (emp.designation || '—');
      case 'department':
        return inlineEdit && onUpdateEmployee ? <InlineText value={emp.department || ''} onCommit={(v) => onUpdateEmployee('department', v)} className="text-xs" /> : (emp.department || '—');
      case 'site': return empAny.site_location || empAny.site || empAny.location || '—';
      case 'joining_date': return fmtDate(empAny.joining_date);
      case 'pan': return empAny.pan || empAny.pan_number || '—';
      case 'bank_account':
        return inlineEdit && onUpdateEmployee
          ? <InlineText value={emp.bank_account || ''} onCommit={(v) => onUpdateEmployee('bank_account', v)} className="text-xs" />
          : (emp.bank_account ? `${empAny.bank_name ? empAny.bank_name + ' - ' : ''}${emp.bank_account}` : '—');
      case 'pay_mode': return 'NEFT / Bank Transfer';
      case 'working_days':
        return inlineEdit && onUpdateValue
          ? <span className="flex items-center gap-1"><InlineAmount value={Number(item.working_days || 0)} onCommit={(v) => onUpdateValue('working_days', v)} /></span>
          : (item.working_days ?? 0);
      case 'calculation_type': return (item.calculation_type || 'monthly').toString().toUpperCase();
      case 'calculation_days': return item.calculation_days || item.working_days || 0;
      default: return '—';
    }
  };

  const detailFields = tpl.sections.employeeDetails.fields.slice();
  // Admin-only helper (Send Payslips dialog): keep Days Considered editable even though the slip layout omits it
  if (inlineEdit && onUpdateValue && !detailFields.some(f => f.key === 'calculation_days')) {
    detailFields.push({ label: 'Calculation Mode', key: 'calculation_type' }, { label: 'Days Considered', key: 'calculation_days' });
  }
  const detailRows: { label: string; key: string }[][] = [];
  for (let i = 0; i < detailFields.length; i += 2) detailRows.push(detailFields.slice(i, i + 2));

  // Earnings / deductions: keep original template index for edit callbacks, hide zero rows only when not editing
  const earnVisible = earnings.map((r, i) => ({ ...r, i })).filter(r => editing || !r.hideIfZero || r.value !== 0);
  const dedVisible = deductions.map((r, i) => ({ ...r, i })).filter(r => editing || !r.hideIfZero || r.value !== 0);
  const tableRows = Math.max(earnVisible.length + 1, dedVisible.length); // +1 for the Gross Earnings line

  const labelCell = (section: 'earnings' | 'deductions', r: PayslipRow & { i: number }) => {
    if (editable) {
      return (
        <div className="flex items-center gap-2 group relative">
          <input value={r.label} onChange={(ev) => onUpdateLabel?.(section, r.i, ev.target.value)} className="w-full bg-transparent border-none focus:ring-0 p-0 text-[11px]" />
          <button onClick={() => onRemoveRow?.(section, r.i)} className="opacity-0 group-hover:opacity-100 p-1 text-red-500 hover:bg-red-50 rounded"><Trash2 size={12} /></button>
        </div>
      );
    }
    if (inlineEdit && onUpdateLabel) {
      return <input value={r.label} onChange={(ev) => onUpdateLabel(section, r.i, ev.target.value)} className="w-full bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5 text-[11px] focus:outline-none focus:ring-1 focus:ring-blue-500" />;
    }
    return r.label;
  };
  const amountCell = (r: PayslipRow) =>
    inlineEdit && onUpdateValue && r.key && INLINE_EDITABLE_KEYS.has(r.key)
      ? <InlineAmount value={r.value} onCommit={(v) => onUpdateValue(r.key as string, v)} />
      : fmt(r.value);

  const leaveBalances: any[] = Array.isArray(itemAny.leave_balances) ? itemAny.leave_balances : [];
  const canEditLeave = !!(inlineEdit && onUpdateLeaveBalances);
  const showLeave = !!tpl.sections.leaveBalances?.enabled && (leaveBalances.length > 0 || canEditLeave);
  const normLeave = (lb: any): LeaveBalanceRow => ({
    type: lb.type || lb.leave_type || '',
    opening: Number(lb.opening ?? 0), allotted: Number(lb.allotted ?? 0),
    availed: Number(lb.availed ?? lb.avail ?? 0), encashed: Number(lb.encashed ?? lb.encash ?? 0),
    adjusted: Number(lb.adjusted ?? lb.adjust ?? 0), closing: Number(lb.closing ?? 0),
  });
  const setLeaveCell = (i: number, field: keyof LeaveBalanceRow, v: string | number) => {
    const next = leaveBalances.map(normLeave);
    (next[i] as any)[field] = v;
    onUpdateLeaveBalances?.(next);
  };
  const addLeaveRow = () => onUpdateLeaveBalances?.([...leaveBalances.map(normLeave), { type: leaveBalances.length ? 'Leave' : 'PL (Paid Leave)', opening: 0, allotted: 0, availed: 0, encashed: 0, adjusted: 0, closing: 0 }]);
  const removeLeaveRow = (i: number) => onUpdateLeaveBalances?.(leaveBalances.map(normLeave).filter((_, idx) => idx !== i));
  const netPay = item.net_salary || 0;
  const netWords = `Rupees ${numberToWords(Math.round(netPay)).replace(/\s*Rupees$/, '')} only`;
  const footer = tpl.sections.footer;
  const attendanceWorkingDays = Number(item.working_days || 0);
  const missingPunchExceptionCount = Array.isArray(itemAny.missing_punch_exception_dates)
    ? itemAny.missing_punch_exception_dates.length
    : 0;
  const deductibleMissingPunchDays = Math.max(
    0,
    Number(itemAny.missing_punches || 0) - missingPunchExceptionCount,
  );
  const attendanceLopDays = Number(item.unpaid_leaves || 0) + deductibleMissingPunchDays;
  const attendancePresentDays = Math.max(0, attendanceWorkingDays - attendanceLopDays);
  const formatDays = (days: number) => days.toLocaleString('en-IN', { maximumFractionDigits: 2 });

  const th = `${border} bg-[#d9d9d9] px-2 py-1.5 text-[11px] font-bold`;
  const td = `${border} px-2 py-1.5 text-[11px]`;

  return (
    <div
      id={domId}
      className="bg-white px-10 py-8 max-w-[850px] mx-auto shadow-xl relative overflow-hidden border border-slate-300 text-black"
      style={{
        minHeight: '1100px',
        fontFamily: serif,
        backgroundImage: header.backgroundImage ? `url(${header.backgroundImage})` : 'none',
        backgroundSize: '100% 100%',
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'center'
      }}
    >
      {header.backgroundImage && <div className="absolute inset-0 pointer-events-none" style={{ backgroundColor: `rgba(255,255,255,${1 - Math.min(100, Math.max(0, (header as any).backgroundOpacity ?? 40)) / 100})` }} />}

      <div className="relative z-10">
        {/* Header: logo + company name, address underneath */}
        <div className="flex items-center gap-4">
          {header.showLogo && (
            <div className="w-[96px] h-[96px] bg-black flex-shrink-0 flex items-center justify-center text-white overflow-hidden">
              {header.logoUrl ? (
                <img src={header.logoUrl} alt="Logo" className="w-full h-full object-contain" />
              ) : (
                <span className="text-3xl font-bold tracking-widest" style={{ fontFamily: sans }}>{header.logoText}</span>
              )}
            </div>
          )}
          <div className="min-w-0 flex-1">
            {inlineEdit && onUpdateHeader ? (
              <InlineText value={header.title || ''} onCommit={(v) => onUpdateHeader('title', v)} className="text-3xl uppercase" />
            ) : (
              <h1 className="text-[34px] leading-tight uppercase font-normal break-words" style={{ fontFamily: sans }}>{header.title}</h1>
            )}
          </div>
        </div>
        <div className="mt-2 ml-[112px]">
          {inlineEdit && onUpdateHeader ? (
            <InlineText value={header.address || ''} onCommit={(v) => onUpdateHeader('address', v)} className="text-[11px]" />
          ) : (
            <p className="text-[11px] text-neutral-500">{header.address}</p>
          )}
        </div>

        {/* Title */}
        <h2 className="text-center text-[22px] font-normal mt-8 mb-4" style={{ fontFamily: sans }}>PAY SLIP — {monthLabel}</h2>

        {/* Employee details (two label/value pairs per row) */}
        {tpl.sections.employeeDetails.enabled && (
          <table className="w-[88%] mx-auto border-collapse mb-10 table-fixed">
            <tbody>
              {detailRows.map((pair, ri) => (
                <tr key={ri}>
                  {pair.map((f, ci) => (
                    <React.Fragment key={f.key + ci}>
                      <td className={`${td} w-[18%] ${ri === 0 ? 'font-bold' : ''}`} style={ri === 0 ? { fontFamily: sans } : undefined}>{f.label}</td>
                      <td className={`${td} w-[32%] ${ri === 0 ? 'font-bold' : ''}`} style={ri === 0 ? { fontFamily: sans } : undefined}>{detailValue(f.key)}</td>
                    </React.Fragment>
                  ))}
                  {pair.length === 1 && <><td className={`${td} w-[18%]`}></td><td className={`${td} w-[32%]`}></td></>}
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {tpl.sections.attendanceDetails?.enabled && (
          <section className="mb-8">
            <h3 className="text-[14px] font-bold mb-2" style={{ fontFamily: sans }}>{tpl.sections.attendanceDetails.title || '2. Attendance Details'}</h3>
            <table className="w-full border-collapse table-fixed">
              <tbody>
                <tr>
                  {[
                    { label: 'No. of Days', value: attendanceWorkingDays },
                    { label: 'No. of Days Present', value: attendancePresentDays },
                    { label: 'LOP Days', value: attendanceLopDays },
                  ].map(({ label, value }) => (
                    <React.Fragment key={label}>
                      <td className={`${td} font-bold`}>{label}</td>
                      <td className={`${td} text-center`}>{formatDays(value)}</td>
                    </React.Fragment>
                  ))}
                </tr>
              </tbody>
            </table>
          </section>
        )}

        {/* Earnings | Deductions */}
        <table className="w-full border-collapse mb-8 table-fixed">
          <thead>
            <tr>
              <th className={`${th} text-left relative group w-[27%]`} style={{ fontFamily: sans }}>
                {tpl.sections.earnings.title || 'EARNINGS'}
                {editable && (
                  <button onClick={() => onAddRow?.('earnings')} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 bg-blue-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"><Plus size={10} /></button>
                )}
              </th>
              <th className={`${th} text-left w-[23%]`} style={{ fontFamily: sans }}>Amount (INR)</th>
              <th className={`${th} text-left relative group w-[27%]`} style={{ fontFamily: sans }}>
                {tpl.sections.deductions.title || 'DEDUCTIONS'}
                {editable && (
                  <button onClick={() => onAddRow?.('deductions')} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"><Plus size={10} /></button>
                )}
              </th>
              <th className={`${th} text-left w-[23%]`} style={{ fontFamily: sans }}>Amount (INR)</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: tableRows }).map((_, ri) => {
              const e = earnVisible[ri];
              const isGross = ri === earnVisible.length;
              const d = dedVisible[ri];
              return (
                <tr key={ri}>
                  {e ? (
                    <>
                      <td className={td}>{labelCell('earnings', e)}</td>
                      <td className={`${td} text-right`}>{amountCell(e)}</td>
                    </>
                  ) : isGross ? (
                    <>
                      <td className={td}>Gross Earnings</td>
                      <td className={`${td} text-right`}>{fmt(grossEarnings)}</td>
                    </>
                  ) : (<><td></td><td></td></>)}
                  {d ? (
                    <>
                      <td className={td}>{labelCell('deductions', d)}</td>
                      <td className={`${td} text-right`}>{amountCell(d)}</td>
                    </>
                  ) : (<><td></td><td></td></>)}
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Net pay */}
        <table className="w-full border-collapse mb-10 table-fixed">
          <tbody>
            <tr className="bg-neutral-100">
              <td className={`${border} px-2 py-2 text-[13px] font-bold w-[60%]`} style={{ fontFamily: sans }}>{tpl.sections.summary.title || 'Net Pay (Gross - Deductions)'}</td>
              <td className={`${border} px-2 py-2 text-[13px] font-bold text-right`} style={{ fontFamily: sans }}>{fmt(netPay)}</td>
            </tr>
            {tpl.sections.summary.showNetPayInWords && (
              <tr>
                <td className={td}>Net Pay(in words)</td>
                <td className={td}>{netWords}</td>
              </tr>
            )}
          </tbody>
        </table>

        {/* Leave balances (only when balance data exists for this payslip) */}
        {showLeave && (
          <div className="mb-4">
            <h3 className="text-center text-[18px] font-normal mb-2" style={{ fontFamily: sans }}>{tpl.sections.leaveBalances?.title || 'Leave Balances'} (as on {monthLabel})</h3>
            <table className="w-[80%] mx-auto border-collapse text-center">
              <thead>
                <tr>
                  {['Leave Type', 'Opening', 'Allotted', 'Avail.', 'Encash.', 'Adjust.', 'Closing'].map(h => (
                    <th key={h} className={`${th} ${h === 'Leave Type' ? 'text-left' : 'text-center'}`} style={{ fontFamily: sans }}>{h}</th>
                  ))}
                  {canEditLeave && <th className="w-6" />}
                </tr>
              </thead>
              <tbody>
                {leaveBalances.map((lb, i) => {
                  const r = normLeave(lb);
                  return canEditLeave ? (
                    <tr key={i}>
                      <td className={`${td} text-left`}><InlineText value={r.type} onCommit={(v) => setLeaveCell(i, 'type', v)} className="text-[11px]" /></td>
                      {(['opening', 'allotted', 'availed', 'encashed', 'adjusted', 'closing'] as const).map(k => (
                        <td key={k} className={td}><InlineNumber value={r[k]} onCommit={(v) => setLeaveCell(i, k, v)} /></td>
                      ))}
                      <td className="pl-1"><button onClick={() => removeLeaveRow(i)} className="p-1 text-red-500 hover:bg-red-50 rounded" title="Remove"><Trash2 size={12} /></button></td>
                    </tr>
                  ) : (
                    <tr key={i}>
                      <td className={`${td} text-left`}>{r.type}</td>
                      <td className={td}>{r.opening}</td>
                      <td className={td}>{r.allotted}</td>
                      <td className={td}>{r.availed}</td>
                      <td className={td}>{r.encashed}</td>
                      <td className={td}>{r.adjusted}</td>
                      <td className={td}>{r.closing}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {canEditLeave && (
              <div className="w-[80%] mx-auto mt-1">
                <button onClick={addLeaveRow} className="inline-flex items-center gap-1 text-[11px] text-blue-600 hover:underline" style={{ fontFamily: sans }}><Plus size={11} /> Add leave type</button>
              </div>
            )}
          </div>
        )}

        {footer.reimbursementsNote && (
          <p className="text-[12px] mt-3 mb-8"><span className="font-bold" style={{ fontFamily: sans }}>Reimbursements -</span> {footer.reimbursementsNote}</p>
        )}

        {/* Remarks */}
        {footer.remarks.length > 0 && (
          <div className="mb-6">
            <h4 className="text-[20px] font-normal mb-1">Remarks:</h4>
            <ul className="space-y-0.5">
              {footer.remarks.map((r, i) => (
                <li key={i} className="text-[9px] leading-snug" style={{ fontFamily: sans }}>- {r}</li>
              ))}
            </ul>
          </div>
        )}

        {footer.preparedBy && <p className="text-[10px] mb-2">Prepared By: {footer.preparedBy}</p>}
        {footer.showGeneratedDate && <p className="text-[10px]">Generated on: {fmtDate(new Date())}</p>}
      </div>
    </div>
  );
}