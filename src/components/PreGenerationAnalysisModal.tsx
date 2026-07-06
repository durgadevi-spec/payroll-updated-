import React, { useState, useEffect } from 'react';
import { X, Check, AlertTriangle, User, Clock, Calendar, ChevronLeft, ChevronRight } from 'lucide-react';

interface PreviewProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (previewData: any) => void;
  employeeIds: string[];
  month: number;
  year: number;
}

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function getAttClass(status: string) {
  if (status === 'Valid 9 Hours') return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300';
  if (status === 'N/A') return 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400';
  if (status === 'Less Than 9 Hours') return 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300';
  return 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300';
}

function getPaidClass(status: string) {
  if (status.includes('Unpaid') || status.includes('Sandwich')) return 'bg-red-100 text-red-700 font-semibold dark:bg-red-900/40 dark:text-red-300';
  if (status.includes('Paid Leave')) return 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300';
  if (status.includes('OD')) return 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300';
  return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300';
}

function SummaryBadge({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <div className={`flex flex-col items-center px-4 py-2 rounded-lg ${color}`}>
      <span className="text-lg font-bold leading-tight">{value}</span>
      <span className="text-[10px] font-medium uppercase tracking-wide mt-0.5 opacity-80 whitespace-nowrap">{label}</span>
    </div>
  );
}

export function PreGenerationAnalysisModal({ isOpen, onClose, onConfirm, employeeIds, month, year }: PreviewProps) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeEmpIdx, setActiveEmpIdx] = useState(0);

  useEffect(() => {
    if (isOpen && employeeIds.length > 0) {
      setLoading(true);
      setError(null);
      setActiveEmpIdx(0);
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
    }
  }, [isOpen, employeeIds, month, year]);

  if (!isOpen) return null;

  const employees = data?.employees || [];
  const emp = employees[activeEmpIdx];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-4 pb-4 px-4 bg-slate-900/60 backdrop-blur-sm overflow-y-auto">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-6xl flex flex-col" style={{ minHeight: '80vh', maxHeight: '95vh' }}>

        {/* ── Modal Header ── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 rounded-t-2xl flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-indigo-600 flex items-center justify-center">
              <Calendar className="w-4 h-4 text-white" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white leading-tight">Payroll Verification &amp; Analysis</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">{MONTH_NAMES[month - 1]} {year} · Review before generating</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ── Body ── */}
        <div className="flex-1 overflow-hidden flex flex-col">

          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-4 text-slate-500">
              <div className="animate-spin rounded-full h-10 w-10 border-2 border-indigo-500 border-t-transparent" />
              <p className="text-sm">Analyzing attendance, LMS leaves, and sandwich rules…</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3 text-red-500">
              <AlertTriangle className="w-8 h-8" />
              <p className="text-sm font-medium">{error}</p>
            </div>
          ) : employees.length === 0 ? (
            <div className="flex items-center justify-center py-20 text-slate-400 text-sm">No data available for the selected period.</div>
          ) : (
            <>
              {/* ── Employee Tabs ── */}
              {employees.length > 1 && (
                <div className="flex gap-1 px-6 pt-3 pb-0 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-x-auto flex-shrink-0">
                  {employees.map((e: any, i: number) => (
                    <button
                      key={e.id}
                      onClick={() => setActiveEmpIdx(i)}
                      className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors whitespace-nowrap ${
                        i === activeEmpIdx
                          ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 bg-indigo-50/60 dark:bg-indigo-900/20'
                          : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                      }`}
                    >
                      <User className="w-3.5 h-3.5" />
                      {e.name}
                      {e.summary.unpaidDays > 0 && (
                        <span className="bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none">{e.summary.unpaidDays}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {emp && (
                <div className="flex flex-col flex-1 overflow-hidden">

                  {/* ── Employee Summary Bar ── */}
                  <div className="px-6 py-4 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700 flex-shrink-0">
                    <div className="flex flex-wrap items-center justify-between gap-4">
                      {/* Name + CTC */}
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm">
                          {emp.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="font-bold text-slate-900 dark:text-white text-base leading-tight">{emp.name}</p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            Monthly Salary: ₹{emp.ctc ? Math.round(emp.ctc / 12).toLocaleString('en-IN') : '—'}
                          </p>
                        </div>
                      </div>
                      {/* Summary Badges */}
                      <div className="flex flex-wrap gap-2">
                        <SummaryBadge label="Days in Month" value={emp.days?.length || 0} color="bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200" />
                        <SummaryBadge label="Payable Days" value={emp.summary.totalPayable} color="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" />
                        <SummaryBadge label="Paid Leaves" value={emp.summary.paidLeaves} color="bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" />
                        <SummaryBadge label="Unpaid Days" value={emp.summary.unpaidDays} color="bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" />
                        {emp.summary.lessThan9 > 0 && <SummaryBadge label="< 9 Hours" value={emp.summary.lessThan9} color="bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" />}
                        {emp.summary.punchMissing > 0 && <SummaryBadge label="Punch Missing" value={emp.summary.punchMissing} color="bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300" />}
                        {emp.summary.sundayDeductions > 0 && <SummaryBadge label="Sandwich" value={emp.summary.sundayDeductions} color="bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300" />}
                        {emp.summary.halfDayLeaves > 0 && <SummaryBadge label="Half-Day Leaves" value={emp.summary.halfDayLeaves} color="bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300" />}
                        <SummaryBadge label="Perm Used" value={parseFloat(emp.summary.monthlyAllowanceUsed).toFixed(1) + 'h'} color="bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300" />
                        {emp.summary.permissionLimitExceededDays > 0 && <SummaryBadge label="Perm Exceeded" value={emp.summary.permissionLimitExceededDays} color="bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900/40 dark:text-fuchsia-300" />}
                      </div>
                    </div>
                  </div>

                  {/* ── Day-by-Day Table ── */}
                  <div className="flex-1 overflow-auto">
                    <table className="w-full text-sm border-collapse">
                      <thead>
                        <tr className="bg-slate-100 dark:bg-slate-800 sticky top-0 z-10">
                          <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide whitespace-nowrap border-b border-slate-200 dark:border-slate-700 w-36">Date</th>
                          <th className="text-center px-3 py-2.5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide whitespace-nowrap border-b border-slate-200 dark:border-slate-700 w-24">Punch In</th>
                          <th className="text-center px-3 py-2.5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide whitespace-nowrap border-b border-slate-200 dark:border-slate-700 w-24">Punch Out</th>
                          <th className="text-center px-3 py-2.5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide whitespace-nowrap border-b border-slate-200 dark:border-slate-700 w-16">Hours</th>
                          <th className="text-center px-3 py-2.5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide whitespace-nowrap border-b border-slate-200 dark:border-slate-700 w-28">Permission</th>
                          <th className="text-center px-3 py-2.5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide whitespace-nowrap border-b border-slate-200 dark:border-slate-700 w-16">Eligible</th>
                          <th className="text-center px-3 py-2.5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide whitespace-nowrap border-b border-slate-200 dark:border-slate-700 w-32">Attendance</th>
                          <th className="text-left px-3 py-2.5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide whitespace-nowrap border-b border-slate-200 dark:border-slate-700 w-36">LMS Leave</th>
                          <th className="text-center px-3 py-2.5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide whitespace-nowrap border-b border-slate-200 dark:border-slate-700 w-32">Paid / Unpaid</th>
                          <th className="text-left px-3 py-2.5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide border-b border-slate-200 dark:border-slate-700">Deduction Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {emp.days.map((day: any, idx: number) => {
                          const isDeductible = day.salary_deduction_applicable;
                          const isSunday = day.day === 'Sun';
                          const isSat = day.day === 'Sat';
                          return (
                            <tr
                              key={idx}
                              className={`border-b border-slate-100 dark:border-slate-800 transition-colors ${
                                isDeductible
                                  ? 'bg-red-50/60 dark:bg-red-900/10 hover:bg-red-100/60'
                                  : isSunday || isSat
                                  ? 'bg-slate-50/80 dark:bg-slate-800/30 hover:bg-slate-100/60'
                                  : 'hover:bg-indigo-50/30 dark:hover:bg-slate-800/20'
                              }`}
                            >
                              {/* Date */}
                              <td className="px-4 py-2 whitespace-nowrap">
                                <div className="flex items-center gap-2">
                                  <span className={`w-7 h-7 rounded-md flex items-center justify-center text-xs font-bold ${
                                    isSunday ? 'bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400'
                                    : isSat ? 'bg-slate-100 text-slate-400 dark:bg-slate-700/60 dark:text-slate-500'
                                    : isDeductible ? 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400'
                                    : 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300'
                                  }`}>
                                    {new Date(day.date + 'T00:00:00').getDate()}
                                  </span>
                                  <div>
                                    <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">{day.date}</p>
                                    <p className={`text-[10px] font-medium ${
                                      isSunday ? 'text-slate-400' : isSat ? 'text-slate-400' : 'text-slate-400'
                                    }`}>{day.day}</p>
                                  </div>
                                </div>
                              </td>

                              {/* Punch In */}
                              <td className="px-3 py-2 text-center">
                                <span className={`text-xs font-medium ${day.punch_in === '-' ? 'text-slate-300 dark:text-slate-600' : 'text-slate-700 dark:text-slate-200'}`}>
                                  {day.punch_in}
                                </span>
                              </td>

                              {/* Punch Out */}
                              <td className="px-3 py-2 text-center">
                                <span className={`text-xs font-medium ${day.punch_out === '-' ? 'text-slate-300 dark:text-slate-600' : 'text-slate-700 dark:text-slate-200'}`}>
                                  {day.punch_out}
                                </span>
                              </td>

                              {/* Hours */}
                              <td className="px-3 py-2 text-center">
                                <span className={`text-xs font-medium tabular-nums ${
                                  parseFloat(day.total_hours) > 0 ? 'text-slate-700 dark:text-slate-300' : 'text-slate-300 dark:text-slate-600'
                                }`}>
                                  {day.total_hours === '0.0' ? '—' : `${day.total_hours}h`}
                                </span>
                              </td>

                              {/* Permission */}
                              <td className="px-3 py-2">
                                <div className="flex flex-col items-center justify-center">
                                  {day.permission_status === 'Approved' ? (
                                    <div className="flex flex-col items-center bg-teal-50 dark:bg-teal-900/30 px-2 py-0.5 rounded border border-teal-100 dark:border-teal-800">
                                      <span className="text-[10px] text-teal-700 dark:text-teal-300 font-medium whitespace-nowrap">{day.permission_from} - {day.permission_to}</span>
                                      <span className="text-[10px] font-bold text-teal-600 dark:text-teal-400">+{day.permission_hours}h</span>
                                    </div>
                                  ) : parseFloat(day.monthly_permission_used) > 0 ? (
                                    <div className="flex flex-col items-center bg-blue-50 dark:bg-blue-900/30 px-2 py-0.5 rounded border border-blue-100 dark:border-blue-800">
                                      <span className="text-[10px] text-blue-700 dark:text-blue-300 font-medium whitespace-nowrap">Allowance</span>
                                      <span className="text-[10px] font-bold text-blue-600 dark:text-blue-400">+{day.monthly_permission_used}h</span>
                                    </div>
                                  ) : (
                                    <span className="text-slate-300 dark:text-slate-600 text-xs">—</span>
                                  )}
                                </div>
                              </td>

                              {/* Eligible Hours */}
                              <td className="px-3 py-2 text-center">
                                <span className={`text-xs font-bold tabular-nums ${
                                  parseFloat(day.eligible_hours) >= 9 ? 'text-emerald-600 dark:text-emerald-400'
                                  : parseFloat(day.eligible_hours) > 0 ? 'text-amber-600 dark:text-amber-400'
                                  : 'text-slate-300 dark:text-slate-600'
                                }`}>
                                  {day.eligible_hours === '0.00' ? '—' : `${day.eligible_hours}h`}
                                </span>
                              </td>

                              {/* Attendance */}
                              <td className="px-3 py-2 text-center">
                                <span className={`text-[11px] px-2 py-1 rounded-full font-medium whitespace-nowrap ${getAttClass(day.attendance_status)}`}>
                                  {day.attendance_status}
                                </span>
                              </td>

                              {/* LMS Leave */}
                              <td className="px-3 py-2">
                                <div className="flex flex-col gap-0.5">
                                  <span className="text-xs text-slate-600 dark:text-slate-300">{day.lms_leave_status}</span>
                                  {day.leave_type && day.leave_type !== '-' && (
                                    <span className="text-[10px] text-indigo-600 dark:text-indigo-400 font-medium">({day.leave_type})</span>
                                  )}
                                </div>
                              </td>

                              {/* Paid/Unpaid */}
                              <td className="px-3 py-2 text-center">
                                <span className={`text-[11px] px-2 py-1 rounded-full font-medium whitespace-nowrap ${getPaidClass(day.paid_unpaid)}`}>
                                  {day.paid_unpaid}
                                </span>
                              </td>

                              {/* Deduction Reason */}
                              <td className="px-3 py-2">
                                {day.deduction_reason ? (
                                  <div className="flex items-center gap-1.5">
                                    {day.sunday_sandwich && <AlertTriangle className="w-3 h-3 text-rose-500 flex-shrink-0" />}
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
                  </div>

                  {/* ── Employee navigation (if multiple) ── */}
                  {employees.length > 1 && (
                    <div className="px-6 py-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between bg-white dark:bg-slate-900 flex-shrink-0">
                      <button
                        onClick={() => setActiveEmpIdx(i => Math.max(0, i - 1))}
                        disabled={activeEmpIdx === 0}
                        className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-indigo-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      >
                        <ChevronLeft className="w-4 h-4" /> Previous
                      </button>
                      <span className="text-xs text-slate-400">{activeEmpIdx + 1} of {employees.length} employees</span>
                      <button
                        onClick={() => setActiveEmpIdx(i => Math.min(employees.length - 1, i + 1))}
                        disabled={activeEmpIdx === employees.length - 1}
                        className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-indigo-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
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
        <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 rounded-b-2xl flex justify-between items-center flex-shrink-0">
          <p className="text-xs text-slate-400 dark:text-slate-500">
            {loading ? 'Loading…' : `${employees.length} employee${employees.length !== 1 ? 's' : ''} · ${MONTH_NAMES[month - 1]} ${year}`}
          </p>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-5 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-600 dark:hover:bg-slate-700 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => onConfirm(data)}
              disabled={loading || employees.length === 0}
              className="flex items-center gap-2 px-6 py-2 text-sm font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Check className="w-4 h-4" />
              Confirm &amp; Generate Payroll
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
