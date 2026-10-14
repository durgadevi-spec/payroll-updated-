import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCcw, Timer, Users, IndianRupee, ChevronDown, ChevronRight, Download, AlertTriangle, CalendarDays, BadgeCheck, Clock3, Search, Calculator } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { TableSkeleton } from '../components/ui/Skeleton';
import { formatCurrency, getMonthName } from '../lib/payrollCalculator';

interface OtRow {
  id: string;
  employee_id: string;
  employee_name: string;
  employee_code: string;
  ot_date: string;
  from_time: string | null;
  to_time: string | null;
  ot_hours: number;
  status: string;
  reason: string;
  per_hour_salary: number;
  ot_amount: number;
}

interface OtEmployee {
  employee_id: string;
  employee_name: string;
  employee_code: string;
  department: string;
  monthly_salary: number;
  per_hour_salary: number;
  requests: number;
  ot_hours: number;
  ot_amount: number;
}

interface OtResponse {
  month: number;
  year: number;
  table: string | null;
  rows: OtRow[];
  employees: OtEmployee[];
  totals: { requests: number; hours: number; amount: number; employees: number };
  settings?: { hours_per_day: number; basis: string; days_for_rate: number };
  skipped_unmatched?: number;
  warning?: string;
  error?: string;
}

const money = (n: number) => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function statusVariant(s: string): 'success' | 'warning' | 'error' | 'neutral' {
  const v = s.toLowerCase();
  if (v === 'approved') return 'success';
  if (v === 'pending') return 'warning';
  if (v === 'rejected' || v === 'cancelled') return 'error';
  return 'neutral';
}

function fmtDate(key: string) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', weekday: 'short' });
}

export function Overtime() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [statusFilter, setStatusFilter] = useState<'approved' | 'all'>('approved');
  const [hoursPerDay, setHoursPerDay] = useState(8);
  const [basis, setBasis] = useState<'calendar' | 'working'>('calendar');
  const [data, setData] = useState<OtResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        month: String(month),
        year: String(year),
        status: statusFilter,
        hours_per_day: String(hoursPerDay),
        basis,
      });
      const res = await fetch(`/api/overtime?${qs.toString()}`);
      const json: OtResponse = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load overtime');
      setData(json);
    } catch (e: any) {
      setError(e?.message || 'Failed to load overtime');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [month, year, statusFilter, hoursPerDay, basis]);

  useEffect(() => { load(); }, [load]);

  const employees = useMemo(() => {
    const list = data?.employees || [];
    const q = search.trim().toLowerCase();
    return q ? list.filter(e => e.employee_name.toLowerCase().includes(q) || (e.employee_code || '').toLowerCase().includes(q)) : list;
  }, [data, search]);

  const rowsByEmp = useMemo(() => {
    const m = new Map<string, OtRow[]>();
    (data?.rows || []).forEach(r => { const a = m.get(r.employee_id) || []; a.push(r); m.set(r.employee_id, a); });
    return m;
  }, [data]);

  const toggle = (id: string) => setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const exportCsv = () => {
    if (!data) return;
    const header = ['Employee Code', 'Employee', 'Date', 'From', 'To', 'OT Hours', 'Per Hour Salary', 'OT Amount', 'Status', 'Reason'];
    const lines = data.rows.map(r => [r.employee_code, r.employee_name, r.ot_date, r.from_time || '', r.to_time || '', r.ot_hours, r.per_hour_salary, r.ot_amount, r.status, r.reason]
      .map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','));
    const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `overtime-${year}-${String(month).padStart(2, '0')}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const years = [now.getFullYear() - 2, now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1];
  const selectCls = 'h-10 px-3 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500';

  return (
    <div className="space-y-6">
      <div className="flex flex-col 2xl:flex-row 2xl:items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-11 h-11 rounded-xl bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
            <Timer size={21} />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-800 dark:text-white">Overtime</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Approved LMS overtime at the employee's normal hourly rate (1×).
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2">
          <label className="relative">
            <span className="sr-only">Month</span>
            <CalendarDays size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <select className={`${selectCls} w-full sm:w-auto pl-9 pr-8`} value={month} onChange={e => setMonth(Number(e.target.value))}>
              {Array.from({ length: 12 }, (_, i) => <option key={i} value={i + 1}>{getMonthName(i + 1)}</option>)}
            </select>
          </label>
          <label className="relative">
            <span className="sr-only">Year</span>
            <select className={`${selectCls} w-full sm:w-auto`} value={year} onChange={e => setYear(Number(e.target.value))}>
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
          <label className="relative col-span-2 sm:col-span-1">
            <span className="sr-only">Overtime status</span>
            <BadgeCheck size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <select className={`${selectCls} w-full sm:w-auto pl-9 pr-8`} value={statusFilter} onChange={e => setStatusFilter(e.target.value as 'approved' | 'all')}>
              <option value="approved">Approved only</option>
              <option value="all">All statuses</option>
            </select>
          </label>
          <Button
            variant="outline"
            size="md"
            icon={<RefreshCcw size={15} />}
            onClick={load}
            title="Refresh overtime"
            aria-label="Refresh overtime"
            className="h-10 w-10 !px-0"
          >
            <span className="sr-only">Refresh</span>
          </Button>
          <Button
            variant="outline"
            size="md"
            icon={<Download size={15} />}
            onClick={exportCsv}
            disabled={!data?.rows.length}
            title="Export CSV"
            aria-label="Export CSV"
            className="h-10 w-10 !px-0"
          >
            <span className="sr-only">Export CSV</span>
          </Button>
        </div>
      </div>

      <Card>
        <div className="flex flex-col xl:flex-row xl:items-center gap-4 xl:gap-6 text-sm">
          <div className="flex items-center gap-2 font-semibold text-slate-700 dark:text-slate-200 shrink-0">
            <Calculator size={17} className="text-blue-600 dark:text-blue-400" />
            Per-hour rate
          </div>
          <label className="flex flex-wrap items-center gap-2 text-slate-600 dark:text-slate-300">
            <span>Monthly salary ÷</span>
            <select className={`${selectCls} max-w-full`} value={basis} onChange={e => setBasis(e.target.value as 'calendar' | 'working')}>
              <option value="calendar">calendar days of the month</option>
              <option value="working">working days (excl. Sundays)</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-slate-600 dark:text-slate-300 shrink-0">
            <Clock3 size={15} className="text-slate-400" />
            <span>÷ hours per day</span>
            <input
              type="number" min={1} max={24} step={0.5} value={hoursPerDay}
              onChange={e => setHoursPerDay(Math.max(1, Number(e.target.value) || 8))}
              className={`${selectCls} w-20`}
            />
          </label>
          <span className="xl:ml-auto text-xs text-slate-500 dark:text-slate-400">
            OT amount = OT hours × per-hour salary{data?.settings ? ` (using ${data.settings.days_for_rate} days)` : ''}
          </span>
        </div>
      </Card>

      {(error || data?.warning) && (
        <div className="flex items-start gap-3 p-4 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300 text-sm">
          <AlertTriangle size={18} className="mt-0.5 flex-shrink-0" />
          <div>{error || data?.warning}</div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center text-blue-600"><Users size={18} /></div>
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400">Employees with OT</p>
              <p className="text-xl font-bold text-slate-800 dark:text-white">{data?.totals.employees ?? 0}</p>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-amber-50 dark:bg-amber-900/30 flex items-center justify-center text-amber-600"><Timer size={18} /></div>
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400">Total OT hours ({data?.totals.requests ?? 0} requests)</p>
              <p className="text-xl font-bold text-slate-800 dark:text-white">{data?.totals.hours ?? 0} h</p>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-50 dark:bg-emerald-900/30 flex items-center justify-center text-emerald-600"><IndianRupee size={18} /></div>
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400">Total OT amount — {getMonthName(month)} {year}</p>
              <p className="text-xl font-bold text-slate-800 dark:text-white">{money(data?.totals.amount ?? 0)}</p>
            </div>
          </div>
        </Card>
      </div>

      <Card padding={false}>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 border-b border-slate-200 dark:border-slate-700/60">
          <div className="flex items-center gap-2">
            <Users size={17} className="text-blue-600 dark:text-blue-400" />
            <h3 className="font-semibold text-sm text-slate-800 dark:text-white">Employee-wise Overtime</h3>
          </div>
          <label className="relative w-full sm:w-64">
            <span className="sr-only">Search employee by name or code</span>
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name / code"
              className={`${selectCls} pl-9 w-full`}
            />
          </label>
        </div>

        {loading ? (
          <div className="p-4"><TableSkeleton /></div>
        ) : employees.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500 dark:text-slate-400">
            No overtime found for {getMonthName(month)} {year}.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/60">
                  <th className="px-4 py-3 w-8"></th>
                  <th className="px-4 py-3">Employee</th>
                  <th className="px-4 py-3 text-right">Monthly Salary</th>
                  <th className="px-4 py-3 text-right">Per Hour</th>
                  <th className="px-4 py-3 text-right">Requests</th>
                  <th className="px-4 py-3 text-right">OT Hours</th>
                  <th className="px-4 py-3 text-right">OT Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                {employees.map(e => {
                  const open = expanded.has(e.employee_id);
                  return (
                    <Fragment key={e.employee_id}>
                      <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer" onClick={() => toggle(e.employee_id)}>
                        <td className="px-4 py-3 text-slate-400">{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-slate-800 dark:text-white">{e.employee_name}</div>
                          <div className="text-xs text-slate-500 dark:text-slate-400">{e.employee_code}{e.department ? ` · ${e.department}` : ''}</div>
                        </td>
                        <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-300">{formatCurrency(e.monthly_salary)}</td>
                        <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-300">{money(e.per_hour_salary)}</td>
                        <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-300">{e.requests}</td>
                        <td className="px-4 py-3 text-right font-medium text-slate-800 dark:text-white">{e.ot_hours} h</td>
                        <td className="px-4 py-3 text-right font-semibold text-emerald-600 dark:text-emerald-400">{money(e.ot_amount)}</td>
                      </tr>
                      {open && (
                        <tr>
                          <td colSpan={7} className="bg-slate-50/70 dark:bg-slate-900/30 px-4 py-3">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-left text-slate-500 dark:text-slate-400">
                                  <th className="py-2 pr-4">Date</th>
                                  <th className="py-2 pr-4">Time</th>
                                  <th className="py-2 pr-4 text-right">Hours</th>
                                  <th className="py-2 pr-4 text-right">× Per Hour</th>
                                  <th className="py-2 pr-4 text-right">Amount</th>
                                  <th className="py-2 pr-4">Status</th>
                                  <th className="py-2">Reason</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(rowsByEmp.get(e.employee_id) || []).map(r => (
                                  <tr key={r.id} className="border-t border-slate-200/70 dark:border-slate-700/40">
                                    <td className="py-2 pr-4 text-slate-700 dark:text-slate-200">{fmtDate(r.ot_date)}</td>
                                    <td className="py-2 pr-4 text-slate-500 dark:text-slate-400">{r.from_time && r.to_time ? `${r.from_time.slice(0, 5)} – ${r.to_time.slice(0, 5)}` : '—'}</td>
                                    <td className="py-2 pr-4 text-right">{r.ot_hours}</td>
                                    <td className="py-2 pr-4 text-right">{money(r.per_hour_salary)}</td>
                                    <td className="py-2 pr-4 text-right font-medium text-emerald-600 dark:text-emerald-400">{money(r.ot_amount)}</td>
                                    <td className="py-2 pr-4"><Badge variant={statusVariant(r.status)} size="sm">{r.status}</Badge></td>
                                    <td className="py-2 text-slate-500 dark:text-slate-400">{r.reason || '—'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50 dark:bg-slate-800/60 font-semibold text-slate-800 dark:text-white">
                  <td></td>
                  <td className="px-4 py-3" colSpan={3}>Total</td>
                  <td className="px-4 py-3 text-right">{data?.totals.requests}</td>
                  <td className="px-4 py-3 text-right">{data?.totals.hours} h</td>
                  <td className="px-4 py-3 text-right text-emerald-600 dark:text-emerald-400">{money(data?.totals.amount ?? 0)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      {!!data?.skipped_unmatched && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {data.skipped_unmatched} OT request(s) were skipped because the LMS user could not be matched to a payroll employee (by employee code / email).
        </p>
      )}
    </div>
  );
}