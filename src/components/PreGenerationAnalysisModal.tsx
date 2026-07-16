import React, { useState, useEffect, useRef } from 'react';
import { X, Check, AlertTriangle, Calendar, ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react';

interface PreviewProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (previewData: any) => void;
  employeeIds: string[];
  month: number;
  year: number;
  viewOnly?: boolean;
  fullPage?: boolean;
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// ── Semantic status styling — restrained, two-tone, no rainbow ──
function getAttClass(status: string) {
  if (status === 'Valid 9 Hours') return 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-500/20';
  if (status === 'N/A') return 'bg-slate-100 text-slate-500 ring-1 ring-inset ring-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:ring-slate-700';
  if (status === 'Less Than 9 Hours') return 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:ring-amber-500/20';
  return 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-200 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-500/20';
}

function getPaidClass(status: string) {
  if (status.includes('Unpaid') || status.includes('Sandwich')) return 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-200 font-medium dark:bg-red-500/10 dark:text-red-400 dark:ring-red-500/20';
  if (status.includes('Partially Paid')) return 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200 font-medium dark:bg-amber-500/10 dark:text-amber-400 dark:ring-amber-500/20';
  if (status.includes('Paid Leave')) return 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200 dark:bg-blue-500/10 dark:text-blue-400 dark:ring-blue-500/20';
  if (status.includes('OD')) return 'bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-200 dark:bg-violet-500/10 dark:text-violet-400 dark:ring-violet-500/20';
  return 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-500/20';
}

// Neutral by default; only shifts to a semantic color when the number is worth flagging
function Stat({ label, value, tone = 'neutral' }: { label: string; value: number | string; tone?: 'neutral' | 'good' | 'warn' | 'bad' }) {
  const toneClass = {
    neutral: 'text-slate-900 dark:text-white',
    good: 'text-emerald-600 dark:text-emerald-400',
    warn: 'text-amber-600 dark:text-amber-400',
    bad: 'text-red-600 dark:text-red-400',
  }[tone];
  return (
    <div className="flex flex-col items-start px-4 py-2.5 min-w-[92px] border-l border-slate-200 dark:border-slate-700 first:border-l-0 first:pl-0">
      <span className={`text-xl font-semibold leading-tight tabular-nums ${toneClass}`}>{value}</span>
      <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mt-0.5 whitespace-nowrap">{label}</span>
    </div>
  );
}

export function PreGenerationAnalysisModal({ isOpen, onClose, onConfirm, employeeIds, month, year, viewOnly = false, fullPage = false }: PreviewProps) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeEmpIdx, setActiveEmpIdx] = useState(0);
  const [showStats, setShowStats] = useState(false);
  const lastFetchKey = useRef<string>('');

  // Stabilize employeeIds so array reference changes don't re-trigger
  const empIdsKey = JSON.stringify(employeeIds);

  useEffect(() => {
    if (!isOpen || employeeIds.length === 0) return;
    const fetchKey = `${month}-${year}-${empIdsKey}`;
    if (lastFetchKey.current === fetchKey && data) return; // Already loaded this exact data
    lastFetchKey.current = fetchKey;
    setLoading(true);
    setError(null);
    setActiveEmpIdx(0);
    setShowStats(false);
    fetch('/api/payroll/generation-preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employeeIds, month, year })
    })
      .then(res => {
        if (!res.ok) throw new Error(`Server error: ${res.status}`);
        return res.json();
      })
      .then(resData => {
        setData(resData);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setError(err.message);
        setLoading(false);
      });
  }, [isOpen, empIdsKey, month, year]);

  // Reset the fetch key when modal closes so re-opening will re-fetch
  useEffect(() => {
    if (!isOpen) {
      lastFetchKey.current = '';
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const employees = data?.employees || [];
  const emp = employees[activeEmpIdx];

  const wrapperClass = fullPage
    ? 'fixed inset-0 z-50 flex items-stretch justify-center bg-slate-900/50 backdrop-blur-sm overflow-hidden'
    : 'fixed inset-0 z-50 flex items-start justify-center pt-4 pb-4 px-4 bg-slate-900/50 backdrop-blur-sm overflow-y-auto';

  const containerClass = fullPage
    ? 'bg-white dark:bg-slate-900 w-full h-full flex flex-col'
    : 'bg-white dark:bg-slate-900 rounded-xl shadow-xl ring-1 ring-black/5 w-full max-w-6xl flex flex-col';

  const containerStyle: any = fullPage
    ? { minHeight: '100vh', maxHeight: '100vh' }
    : { minHeight: '80vh', maxHeight: '95vh' };

  return (
    <div className={wrapperClass}>
      <div className={containerClass} style={containerStyle}>

        {/* ── Modal Header ── */}
        <div className="flex items-center justify-between px-6 py-3.5 border-b border-slate-200 dark:border-slate-700 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-md bg-indigo-600 flex items-center justify-center flex-shrink-0">
              <Calendar className="w-4 h-4 text-white" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white leading-tight">Payroll verification and analysis</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{MONTH_NAMES[month - 1]} {year} · Review before generating</p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-4.5 h-4.5" />
          </button>
        </div>

        {/* ── Body ── */}
        <div className="flex-1 overflow-hidden flex flex-col">

          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3 text-slate-500 dark:text-slate-400">
              <div className="animate-spin rounded-full h-8 w-8 border-2 border-indigo-500 border-t-transparent" />
              <p className="text-sm">Analyzing attendance, LMS leaves, and sandwich rules…</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3 text-red-500">
              <AlertTriangle className="w-7 h-7" />
              <p className="text-sm font-medium">{error}</p>
            </div>
          ) : employees.length === 0 ? (
            <div className="flex items-center justify-center py-20 text-slate-400 text-sm">No data available for the selected period.</div>
          ) : (
            <>
              {/* ── Employee Tabs ── */}
              {employees.length > 1 && (
                <div className="flex gap-0.5 px-4 border-b border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/30 overflow-x-auto flex-shrink-0">
                  {employees.map((e: any, i: number) => (
                    <button
                      key={e.id}
                      onClick={() => setActiveEmpIdx(i)}
                      className={`relative flex items-center gap-2 px-3.5 py-2.5 text-[13px] font-medium transition-colors whitespace-nowrap ${i === activeEmpIdx
                        ? 'text-indigo-600 dark:text-indigo-400'
                        : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
                        }`}
                    >
                      <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-semibold ${i === activeEmpIdx
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                        }`}>
                        {e.name.charAt(0).toUpperCase()}
                      </span>
                      {e.name}
                      {e.summary.unpaidDays > 0 && (
                        <span className="text-[10px] font-semibold text-red-600 dark:text-red-400">{e.summary.unpaidDays}</span>
                      )}
                      {i === activeEmpIdx && (
                        <span className="absolute left-0 right-0 -bottom-px h-[2px] bg-indigo-600 dark:bg-indigo-400" />
                      )}
                    </button>
                  ))}
                </div>
              )}

              {emp && (
                <div className="flex flex-col flex-1 overflow-hidden">

                  {/* ── Employee Summary Bar ── */}
                  <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 flex-shrink-0">
                    <button
                      onClick={() => setShowStats(s => !s)}
                      className="w-full flex items-center justify-between gap-4 px-6 py-3.5 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      {/* Name + Salary */}
                      <div className="flex items-center gap-3 min-w-[180px]">
                        <div className="w-9 h-9 rounded-full bg-indigo-600 flex items-center justify-center text-white font-semibold text-sm flex-shrink-0">
                          {emp.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="text-left">
                          <p className="font-semibold text-slate-900 dark:text-white text-[14px] leading-tight">{emp.name}</p>
                          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            ₹{emp.ctc ? Math.round(emp.ctc / 12).toLocaleString('en-IN') : '—'} / month
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 text-slate-400 dark:text-slate-500">
                        <span className="text-xs font-medium hidden sm:inline">{showStats ? 'Hide summary' : 'Show summary'}</span>
                        <ChevronDown className={`w-4 h-4 transition-transform ${showStats ? 'rotate-180' : ''}`} />
                      </div>
                    </button>

                    {/* Stat strip — collapsible */}
                    {showStats && (
                      <div className="px-6 pb-3.5 flex items-stretch flex-wrap border-t border-slate-100 dark:border-slate-800 pt-3.5">
                        <Stat label="Days in month" value={emp.days?.length || 0} />
                        <Stat label="Payable days" value={emp.summary.totalPayable} tone="good" />
                        <Stat label="Paid leaves" value={emp.summary.paidLeaves} />
                        {(() => {
                          const nonLeave = (emp.summary.punchMissing || 0) + (emp.summary.sundayDeductions || 0) + (emp.summary.lessThan9 || 0);
                          const trueUnpaidLeaves = Math.max(0, (emp.summary.unpaidDays || 0) - nonLeave);
                          return <Stat label="Unpaid leaves" value={trueUnpaidLeaves} tone={trueUnpaidLeaves > 0 ? 'bad' : 'neutral'} />;
                        })()}
                        {emp.summary.lessThan9 > 0 && <Stat label="Under 9 hrs" value={emp.summary.lessThan9} tone="warn" />}
                        {emp.summary.punchMissing > 0 && <Stat label="Punch missing" value={emp.summary.punchMissing} tone="warn" />}
                        {emp.summary.sundayDeductions > 0 && <Stat label="Sandwich ded." value={emp.summary.sundayDeductions} tone="bad" />}
                        {emp.summary.halfDayLeaves > 0 && <Stat label="Half-day leaves" value={emp.summary.halfDayLeaves} />}
                        <Stat label="Permission used" value={parseFloat(emp.summary.monthlyAllowanceUsed).toFixed(1) + 'h'} />
                        {emp.summary.permissionLimitExceededDays > 0 && <Stat label="Perm. exceeded" value={emp.summary.permissionLimitExceededDays} tone="bad" />}
                        {emp.summary.deductibleShortfallHours > 0 && <Stat label="Hourly ded." value={'₹' + Math.round(emp.summary.hourlyDeductionAmount || 0).toLocaleString('en-IN')} tone="bad" />}
                      </div>
                    )}
                  </div>

                  {/* ── Day-by-Day Table ── */}
                  <div className="flex-1 min-h-[300px] overflow-auto bg-white dark:bg-slate-900">
                    <table className="w-full text-sm border-collapse">
                      <thead>
                        <tr className="bg-slate-100 dark:bg-slate-800/60 sticky top-0 z-10">
                          <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide whitespace-nowrap border-b border-r border-slate-200 dark:border-slate-700 w-32">Date</th>
                          <th className="text-center px-3 py-2.5 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide whitespace-nowrap border-b border-r border-slate-200 dark:border-slate-700 w-24">Punch in</th>
                          <th className="text-center px-3 py-2.5 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide whitespace-nowrap border-b border-r border-slate-200 dark:border-slate-700 w-24">Punch out</th>
                          <th className="text-center px-3 py-2.5 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide whitespace-nowrap border-b border-r border-slate-200 dark:border-slate-700 w-16">Hours</th>
                          <th className="text-center px-3 py-2.5 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide whitespace-nowrap border-b border-r border-slate-200 dark:border-slate-700 w-28">Permission</th>
                          <th className="text-center px-3 py-2.5 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide whitespace-nowrap border-b border-r border-slate-200 dark:border-slate-700 w-16">Eligible</th>
                          <th className="text-center px-3 py-2.5 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide whitespace-nowrap border-b border-r border-slate-200 dark:border-slate-700 w-32">Attendance</th>
                          <th className="text-left px-3 py-2.5 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide whitespace-nowrap border-b border-r border-slate-200 dark:border-slate-700 w-36">LMS leave</th>
                          <th className="text-center px-3 py-2.5 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide whitespace-nowrap border-b border-r border-slate-200 dark:border-slate-700 w-32">Paid / unpaid</th>
                          <th className="text-left px-3 py-2.5 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide border-b border-slate-200 dark:border-slate-700">Deduction reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {emp.days.map((day: any, idx: number) => {
                          const isDeductible = day.salary_deduction_applicable;
                          const hasHourlyDed = parseFloat(day.hourly_deduction_amount || 0) > 0;
                          const isSunday = day.day === 'Sun';
                          const isSat = day.day === 'Sat';
                          const isWeekend = isSunday || isSat;
                          const zebra = idx % 2 === 1;
                          return (
                            <tr
                              key={idx}
                              className={`border-b border-slate-100 dark:border-slate-800 transition-colors ${isDeductible
                                ? 'bg-red-50/60 dark:bg-red-500/5 hover:bg-red-50 dark:hover:bg-red-500/10'
                                : hasHourlyDed
                                  ? 'bg-amber-50/60 dark:bg-amber-500/5 hover:bg-amber-50 dark:hover:bg-amber-500/10'
                                  : isWeekend
                                    ? 'bg-slate-50 dark:bg-slate-800/20 hover:bg-slate-100 dark:hover:bg-slate-800/40'
                                    : zebra
                                      ? 'bg-slate-50/40 dark:bg-slate-800/10 hover:bg-slate-50 dark:hover:bg-slate-800/30'
                                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/30'
                                }`}
                            >
                              {/* Date */}
                              <td className="px-4 py-2.5 whitespace-nowrap border-r border-slate-100 dark:border-slate-800">
                                <div className="flex items-center gap-2.5">
                                  <span className={`w-6 h-6 rounded flex items-center justify-center text-[11px] font-semibold tabular-nums flex-shrink-0 ${isWeekend
                                    ? 'bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400'
                                    : isDeductible
                                      ? 'bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-400'
                                      : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                                    }`}>
                                    {new Date(day.date + 'T00:00:00').getDate()}
                                  </span>
                                  <div>
                                    <p className="text-xs font-medium text-slate-700 dark:text-slate-200">{day.date}</p>
                                    <p className="text-[10px] text-slate-400">{day.day}</p>
                                  </div>
                                </div>
                              </td>

                              {/* Punch In */}
                              <td className="px-3 py-2.5 text-center border-r border-slate-100 dark:border-slate-800">
                                <span className={`text-xs tabular-nums ${day.punch_in === '-' ? 'text-slate-300 dark:text-slate-600' : 'text-slate-700 dark:text-slate-200'}`}>
                                  {day.punch_in}
                                </span>
                              </td>

                              {/* Punch Out */}
                              <td className="px-3 py-2.5 text-center border-r border-slate-100 dark:border-slate-800">
                                <span className={`text-xs tabular-nums ${day.punch_out === '-' ? 'text-slate-300 dark:text-slate-600' : 'text-slate-700 dark:text-slate-200'}`}>
                                  {day.punch_out}
                                </span>
                              </td>

                              {/* Hours */}
                              <td className="px-3 py-2.5 text-center border-r border-slate-100 dark:border-slate-800">
                                <span className={`text-xs tabular-nums ${parseFloat(day.total_hours) > 0 ? 'text-slate-700 dark:text-slate-300' : 'text-slate-300 dark:text-slate-600'
                                  }`}>
                                  {day.total_hours === '0.0' ? '—' : `${day.total_hours}h`}
                                </span>
                              </td>

                              {/* Permission */}
                              <td className="px-3 py-2.5 border-r border-slate-100 dark:border-slate-800">
                                <div className="flex flex-col items-center justify-center">
                                  {day.permission_status === 'Approved' ? (
                                    <div className="flex flex-col items-center">
                                      <span className="text-[10px] text-slate-500 dark:text-slate-400 whitespace-nowrap">{day.permission_from}–{day.permission_to}</span>
                                      <span className="text-[10px] font-semibold text-blue-600 dark:text-blue-400 tabular-nums">+{day.permission_hours}h</span>
                                    </div>
                                  ) : parseFloat(day.monthly_permission_used) > 0 ? (
                                    <span className="text-[10px] font-semibold text-blue-600 dark:text-blue-400 tabular-nums">+{day.monthly_permission_used}h</span>
                                  ) : (
                                    <span className="text-slate-300 dark:text-slate-600 text-xs">—</span>
                                  )}
                                </div>
                              </td>

                              {/* Eligible Hours */}
                              <td className="px-3 py-2.5 text-center border-r border-slate-100 dark:border-slate-800">
                                <span className={`text-xs font-semibold tabular-nums ${parseFloat(day.eligible_hours) >= 9 ? 'text-emerald-600 dark:text-emerald-400'
                                  : parseFloat(day.eligible_hours) > 0 ? 'text-amber-600 dark:text-amber-400'
                                    : 'text-slate-300 dark:text-slate-600'
                                  }`}>
                                  {day.eligible_hours === '0.00' ? '—' : `${day.eligible_hours}h`}
                                </span>
                              </td>

                              {/* Attendance */}
                              <td className="px-3 py-2.5 text-center border-r border-slate-100 dark:border-slate-800">
                                <span className={`text-[11px] px-2 py-0.5 rounded font-medium whitespace-nowrap ${getAttClass(day.attendance_status)}`}>
                                  {day.attendance_status}
                                </span>
                              </td>

                              {/* LMS Leave */}
                              <td className="px-3 py-2.5 border-r border-slate-100 dark:border-slate-800">
                                <div className="flex flex-col gap-0.5">
                                  <span className="text-xs text-slate-600 dark:text-slate-300">{day.lms_leave_status}</span>
                                  {day.leave_type && day.leave_type !== '-' && (
                                    <span className="text-[10px] text-slate-400">{day.leave_type}</span>
                                  )}
                                </div>
                              </td>

                              {/* Paid/Unpaid */}
                              <td className="px-3 py-2.5 text-center border-r border-slate-100 dark:border-slate-800">
                                <span className={`text-[11px] px-2 py-0.5 rounded font-medium whitespace-nowrap ${getPaidClass(day.paid_unpaid)}`}>
                                  {day.paid_unpaid}
                                </span>
                              </td>

                              {/* Deduction Reason */}
                              <td className="px-3 py-2.5">
                                {day.deduction_reason ? (
                                  <div className="flex items-center gap-1.5">
                                    {day.sunday_sandwich && <AlertTriangle className="w-3 h-3 text-red-500 flex-shrink-0" />}
                                    <span className="text-xs text-red-600 dark:text-red-400">{day.deduction_reason}</span>
                                  </div>
                                ) : (
                                  <span className="text-slate-300 dark:text-slate-600 text-xs">—</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>

                    {/* ── Salary Breakdown Panel ── */}
                    {(() => {
                      const monthlySalary = emp.ctc ? Math.round(emp.ctc / 12) : 0;
                      const calDays = emp.days?.length || 30;
                      const perDay = calDays > 0 ? monthlySalary / calDays : 0;

                      const totalUnpaid = emp.summary.unpaidDays || 0;
                      const punchMissingDays = emp.summary.punchMissing || 0;
                      const sundayDeductions = emp.summary.sundayDeductions || 0;
                      const lessThan9 = emp.summary.lessThan9 || 0;

                      const nonLeaveDeductions = punchMissingDays + sundayDeductions + lessThan9;
                      const unpaidLeaveDays = Math.max(0, totalUnpaid - nonLeaveDeductions);

                      const leaveDeduction = Math.round(perDay * unpaidLeaveDays);
                      const punchDeduction = Math.round(perDay * nonLeaveDeductions);
                      const permDeduction = 0; // superseded by precise hourly deduction below (kept at 0 to avoid double count)
                      const hourlyDeductionAmount = Math.round(emp.summary.hourlyDeductionAmount || 0);
                      const totalDeductions = leaveDeduction + punchDeduction + permDeduction + hourlyDeductionAmount;
                      const netSalary = Math.max(0, monthlySalary - totalDeductions);
                      const fmt = (n: number) => '₹' + n.toLocaleString('en-IN');
                      return (
                        <div className="mx-4 mt-5 mb-4 rounded-lg border border-slate-200 dark:border-slate-700">
                          <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
                            <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">Estimated salary breakdown</span>
                            <span className="text-[11px] text-slate-400">Based on attendance data</span>
                          </div>
                          <div className="grid grid-cols-2 sm:grid-cols-5">
                            <div className="px-4 py-3 border-r border-b sm:border-b-0 border-slate-100 dark:border-slate-800">
                              <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-0.5">Monthly salary</p>
                              <p className="text-sm font-semibold text-slate-900 dark:text-white tabular-nums">{fmt(monthlySalary)}</p>
                            </div>
                            <div className="px-4 py-3 border-b sm:border-b-0 sm:border-r border-slate-100 dark:border-slate-800">
                              <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-0.5">Leave deduction</p>
                              <p className={`text-sm font-semibold tabular-nums ${unpaidLeaveDays > 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-400'}`}>{unpaidLeaveDays > 0 ? `−${fmt(leaveDeduction)}` : '—'}</p>
                              <p className="text-[11px] text-slate-400 mt-0.5">{unpaidLeaveDays} unpaid day{unpaidLeaveDays !== 1 ? 's' : ''}</p>
                            </div>
                            <div className="px-4 py-3 border-r border-slate-100 dark:border-slate-800">
                              <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-0.5">Punch ded.</p>
                              <p className={`text-sm font-semibold tabular-nums ${punchDeduction > 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-400'}`}>{punchDeduction > 0 ? `−${fmt(punchDeduction)}` : '—'}</p>
                              <p className="text-[11px] text-slate-400 mt-0.5">{punchMissingDays} day{punchMissingDays !== 1 ? 's' : ''} flagged</p>
                            </div>
                            <div className="px-4 py-3 border-r border-slate-100 dark:border-slate-800">
                              <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-0.5">Hourly ded. (&lt;9h/day)</p>
                              <p className={`text-sm font-semibold tabular-nums ${hourlyDeductionAmount > 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-400'}`}>{hourlyDeductionAmount > 0 ? `−${fmt(hourlyDeductionAmount)}` : '—'}</p>
                              <p className="text-[11px] text-slate-400 mt-0.5">{(emp.summary.deductibleShortfallHours || 0).toFixed(1)}h short</p>
                            </div>
                            <div className="px-4 py-3 bg-emerald-50/60 dark:bg-emerald-500/5">
                              <p className="text-[11px] text-emerald-700 dark:text-emerald-400 font-medium mb-0.5">Estimated net salary</p>
                              <p className="text-base font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">{fmt(netSalary)}</p>
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    {/* ── Hourly Attendance Shortfall Card (bottom summary) ── */}
                    {(() => {
                      const monthlySalary = emp.ctc ? Math.round(emp.ctc / 12) : 0;
                      const totalMissing = emp.summary.totalHoursMissing || 0;
                      const covered = emp.summary.permissionCoveredHours || 0;
                      const deductible = emp.summary.deductibleShortfallHours || 0;
                      const amount = Math.round(emp.summary.hourlyDeductionAmount || 0);
                      const allowanceUsed = parseFloat(emp.summary.monthlyAllowanceUsed || 0);
                      const monthlyCap = 3;
                      const lopHours = Math.max(0, deductible); // hours beyond what LMS permission / 3h allowance could cover
                      if (totalMissing <= 0) return null;
                      return (
                        <div className="mx-4 mb-5 rounded-lg border border-amber-200 dark:border-amber-900/40 bg-amber-50/40 dark:bg-amber-500/5">
                          <div className="px-4 py-2.5 border-b border-amber-200 dark:border-amber-900/40 flex items-center justify-between">
                            <span className="text-xs font-semibold text-amber-800 dark:text-amber-300">Hourly attendance shortfall (biometric &lt;9h/day)</span>
                            <span className="text-[11px] text-amber-600 dark:text-amber-400">Monthly permission allowance: {monthlyCap}h free</span>
                          </div>
                          <div className="grid grid-cols-2 sm:grid-cols-4">
                            <div className="px-4 py-3 border-r border-b sm:border-b-0 border-amber-100 dark:border-amber-900/30">
                              <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-0.5">Total hours missing</p>
                              <p className="text-sm font-semibold text-slate-900 dark:text-white tabular-nums">{totalMissing.toFixed(1)}h</p>
                            </div>
                            <div className="px-4 py-3 border-b sm:border-b-0 sm:border-r border-amber-100 dark:border-amber-900/30">
                              <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-0.5">Covered by permission / allowance</p>
                              <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">{covered.toFixed(1)}h</p>
                              <p className="text-[11px] text-slate-400 mt-0.5">{allowanceUsed.toFixed(1)}h of {monthlyCap}h monthly allowance used — no deduction</p>
                            </div>
                            <div className="px-4 py-3 border-r border-amber-100 dark:border-amber-900/30">
                              <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-0.5">LOP hours (beyond 3h cap / no permission)</p>
                              <p className={`text-sm font-semibold tabular-nums ${lopHours > 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-400'}`}>{lopHours > 0 ? `${lopHours.toFixed(1)}h` : '—'}</p>
                            </div>
                            <div className="px-4 py-3 bg-red-50/60 dark:bg-red-500/5">
                              <p className="text-[11px] text-red-700 dark:text-red-400 font-medium mb-0.5">Deducted salary (balance)</p>
                              <p className="text-base font-bold text-red-700 dark:text-red-400 tabular-nums">−₹{amount.toLocaleString('en-IN')}</p>
                              <p className="text-[11px] text-slate-400 mt-0.5">of ₹{monthlySalary.toLocaleString('en-IN')} monthly salary</p>
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                  </div>

                  {/* ── Employee navigation (if multiple) ── */}
                  {employees.length > 1 && (
                    <div className="px-6 py-2.5 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between flex-shrink-0">
                      <button
                        onClick={() => setActiveEmpIdx(i => Math.max(0, i - 1))}
                        disabled={activeEmpIdx === 0}
                        className="flex items-center gap-1.5 text-[13px] font-medium text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      >
                        <ChevronLeft className="w-4 h-4" /> Previous
                      </button>
                      <span className="text-xs text-slate-400 tabular-nums">{activeEmpIdx + 1} of {employees.length} employees</span>
                      <button
                        onClick={() => setActiveEmpIdx(i => Math.min(employees.length - 1, i + 1))}
                        disabled={activeEmpIdx === employees.length - 1}
                        className="flex items-center gap-1.5 text-[13px] font-medium text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      >
                        Next <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="px-6 py-3.5 border-t border-slate-200 dark:border-slate-700 flex justify-between items-center flex-shrink-0">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {loading ? 'Loading…' : `${employees.length} employee${employees.length !== 1 ? 's' : ''} · ${MONTH_NAMES[month - 1]} ${year}`}
          </p>
          <div className="flex gap-2.5">
            <button
              onClick={onClose}
              className="px-4 py-2 text-[13px] font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-600 dark:hover:bg-slate-700 transition-colors"
            >
              {viewOnly ? 'Close' : 'Cancel'}
            </button>
            {!viewOnly && (
              <button
                onClick={() => onConfirm(data)}
                disabled={loading || employees.length === 0}
                className="flex items-center gap-2 px-4 py-2 text-[13px] font-semibold text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Check className="w-4 h-4" />
                Confirm and generate payroll
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}