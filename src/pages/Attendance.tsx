import { useEffect, useMemo, useState } from 'react';
import { RefreshCcw, Clock3, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { TableSkeleton } from '../components/ui/Skeleton';

interface AttendanceLog {
  id?: string;
  emp_code: string;
  punch_time: string;
  terminal?: string;
  punch_state?: number | string;
  [key: string]: any;
}

interface AttendanceSummary {
  employeeCode: string;
  date: string;
  firstIn: string;
  lastOut: string;
  hours: string;
  rawCount: number;
  status: string;
}

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return '--';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

function normalizePunchState(value: number | string | undefined) {
  if (value === 0 || value === '0' || value === 1 || value === '1') {
    return value === 0 || value === '0' ? 'IN' : 'OUT';
  }
  if (value === null || value === undefined || value === '') return 'UNKNOWN';
  const lower = typeof value === 'string' ? value.toLowerCase() : '';
  if (lower === 'in' || lower === 'check-in' || lower === 'checkin') return 'IN';
  if (lower === 'out' || lower === 'check-out' || lower === 'checkout') return 'OUT';
  return String(value);
}

function buildAttendanceSummary(logs: AttendanceLog[]): AttendanceSummary[] {
  const groups: Record<string, AttendanceLog[]> = {};

  for (const log of logs) {
    const dateObj = new Date(log.punch_time);
    const date = dateObj.toLocaleDateString('en-US');
    const key = `${log.emp_code}__${date}`;
    groups[key] = groups[key] || [];
    groups[key].push(log);
  }

  return Object.entries(groups).map(([key, entries]) => {
    const [employeeCode, date] = key.split('__');
    const sorted = [...entries].sort((a, b) => new Date(a.punch_time).getTime() - new Date(b.punch_time).getTime());

    const firstInEntry = sorted.find(log => normalizePunchState(log.punch_state) === 'IN') || sorted[0];
    // Only pick a different lastOut if there's more than one punch or a specific OUT punch
    const lastOutEntry = [...sorted].reverse().find(log => normalizePunchState(log.punch_state) === 'OUT') || (sorted.length > 1 ? sorted[sorted.length - 1] : null);

    const firstInTime = new Date(firstInEntry.punch_time);
    const lastOutTime = lastOutEntry ? new Date(lastOutEntry.punch_time) : null;
    const durationSeconds = (lastOutTime && lastOutTime.getTime() > firstInTime.getTime()) ? (lastOutTime.getTime() - firstInTime.getTime()) / 1000 : 0;

    return {
      employeeCode,
      date,
      firstIn: firstInEntry.punch_time ? new Date(firstInEntry.punch_time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '--',
      lastOut: lastOutTime ? lastOutTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '--',
      hours: durationSeconds > 0 ? formatDuration(durationSeconds) : 'Incomplete',
      rawCount: sorted.length,
      status: durationSeconds > 0 ? 'Complete' : 'Incomplete',
    };
  }).sort((a, b) => (a.date > b.date ? -1 : 1));
}

export function Attendance() {
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [selectedEmployee, setSelectedEmployee] = useState('all');

  useEffect(() => {
    loadAttendance();
  }, []);

  const summary = useMemo(() => buildAttendanceSummary(logs), [logs]);

  // Get unique employee codes for filter
  const employeeCodes = useMemo(() => {
    const codes = new Set(logs.map(log => log.emp_code));
    return Array.from(codes).sort();
  }, [logs]);

  // Apply filters
  const filteredSummary = useMemo(() => {
    let filtered = summary;

    if (selectedEmployee !== 'all') {
      filtered = filtered.filter(item => item.employeeCode === selectedEmployee);
    }

    if (fromDate) {
      const from = new Date(fromDate);
      filtered = filtered.filter(item => new Date(item.date) >= from);
    }

    if (toDate) {
      const to = new Date(toDate);
      to.setHours(23, 59, 59, 999);
      filtered = filtered.filter(item => new Date(item.date) <= to);
    }

    return filtered;
  }, [summary, selectedEmployee, fromDate, toDate]);

  async function loadAttendance() {
    setError('');
    setLoading(true);

    try {
      const response = await fetch('/api/attendance/logs');
      if (!response.ok) {
        const body = await response.text();
        throw new Error(body || 'Unable to load attendance logs');
      }
      const data = await response.json();
      setLogs(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Failed to load attendance logs');
    } finally {
      setLoading(false);
    }
  }

  async function handleSync() {
    setError('');
    setLoading(true);
    try {
      const response = await fetch('/api/attendance/sync-direct', { method: 'POST' });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(body || 'Unable to sync attendance logs');
      }
      const data = await response.json();
      await loadAttendance(); // Reload from DB after sync
      alert(data.message || 'Sync successful');
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Failed to sync attendance logs');
      setLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-blue-100 text-blue-700 px-3 py-1 text-xs font-semibold uppercase tracking-wider dark:bg-slate-800 dark:text-blue-300">
            <Clock3 size={14} /> Attendance
          </div>
          <h1 className="mt-3 text-2xl font-semibold text-slate-900 dark:text-white">Biometric IN/OUT logs</h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400 max-w-2xl">
            Fetch employee punch records from the biometric API, then calculate first check-in, last check-out and total working hours per day.
          </p>
        </div>

        <div className="flex gap-2">
          <Button
            variant="outline"
            icon={<RefreshCcw size={16} />}
            onClick={handleSync}
            loading={loading}
            className="whitespace-nowrap"
          >
            Sync Device
          </Button>
          <Button
            icon={<RefreshCcw size={16} />}
            onClick={loadAttendance}
            loading={loading}
            className="whitespace-nowrap"
          >
            Refresh logs
          </Button>
        </div>
      </div>

      <Card>
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-3xl border border-slate-200 dark:border-slate-700 p-4 bg-white dark:bg-slate-900">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Total logs</p>
            <p className="mt-3 text-2xl font-semibold text-slate-900 dark:text-white">{logs.length}</p>
          </div>
          <div className="rounded-3xl border border-slate-200 dark:border-slate-700 p-4 bg-white dark:bg-slate-900">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Employee-days</p>
            <p className="mt-3 text-2xl font-semibold text-slate-900 dark:text-white">{filteredSummary.length}</p>
          </div>
          <div className="rounded-3xl border border-slate-200 dark:border-slate-700 p-4 bg-white dark:bg-slate-900">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Incomplete records</p>
            <p className="mt-3 text-2xl font-semibold text-slate-900 dark:text-white">{filteredSummary.filter(item => item.status === 'Incomplete').length}</p>
          </div>
        </div>
      </Card>

      <Card className="space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">Filters</h3>
          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">From Date</label>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">To Date</label>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Employee</label>
              <select
                value={selectedEmployee}
                onChange={(e) => setSelectedEmployee(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              >
                <option value="all">All Employees</option>
                {employeeCodes.map(code => (
                  <option key={code} value={code}>{code}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </Card>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-red-700 dark:border-red-700/40 dark:bg-red-950/30">
          {error}
        </div>
      )}

      <Card className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Attendance summary</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">First IN, last OUT and working hours grouped by employee and date.</p>
          </div>
          <div className="text-sm text-slate-500 dark:text-slate-400">Showing {filteredSummary.length} of {summary.length} records</div>
        </div>

        {loading ? (
          <TableSkeleton rows={6} cols={6} />
        ) : filteredSummary.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
            {summary.length === 0 ? 'No attendance logs available yet. Click refresh to fetch data from the biometric API.' : 'No records match your filters.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-700 dark:text-slate-200">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-[0.2em] text-slate-500 dark:border-slate-700">
                  <th className="px-3 py-3">Employee Code</th>
                  <th className="px-3 py-3">Date</th>
                  <th className="px-3 py-3">First IN</th>
                  <th className="px-3 py-3">Last OUT</th>
                  <th className="px-3 py-3">Hours</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-3 py-3">Punches</th>
                </tr>
              </thead>
              <tbody>
                {filteredSummary.map(item => (
                  <tr key={`${item.employeeCode}-${item.date}`} className="border-b border-slate-200 dark:border-slate-700 last:border-none">
                    <td className="px-3 py-3 font-medium text-slate-900 dark:text-white">{item.employeeCode}</td>
                    <td className="px-3 py-3">{item.date}</td>
                    <td className="px-3 py-3">{item.firstIn}</td>
                    <td className="px-3 py-3">{item.lastOut}</td>
                    <td className="px-3 py-3">{item.hours}</td>
                    <td className="px-3 py-3 text-sm font-medium">
                      <span className={`inline-flex items-center rounded-full px-2 py-1 ${item.status === 'Complete' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200' : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-200'}`}>
                        {item.status}
                      </span>
                    </td>
                    <td className="px-3 py-3">{item.rawCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Raw transactions</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">The raw API response from the biometric device service.</p>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs uppercase tracking-wider text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            <ArrowUpRight size={14} /> Source: IClock
          </span>
        </div>

        {loading ? (
          <TableSkeleton rows={4} cols={6} />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm text-slate-700 dark:text-slate-200">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-[0.2em] text-slate-500 dark:border-slate-700">
                  <th className="px-3 py-3">Employee Code</th>
                  <th className="px-3 py-3">Punch Time</th>
                  <th className="px-3 py-3">Terminal</th>
                  <th className="px-3 py-3">Punch State</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const filteredLogs = selectedEmployee !== 'all' 
                    ? logs.filter(log => log.emp_code === selectedEmployee)
                    : logs;
                  
                  const dateFilteredLogs = filteredLogs.filter(log => {
                    const logDate = new Date(log.punch_time);
                    if (fromDate && logDate < new Date(fromDate)) return false;
                    if (toDate) {
                      const toDateObj = new Date(toDate);
                      toDateObj.setHours(23, 59, 59, 999);
                      if (logDate > toDateObj) return false;
                    }
                    return true;
                  });

                  return dateFilteredLogs.slice(0, 20).map((log, index) => (
                    <tr key={`${log.emp_code}-${index}`} className="border-b border-slate-200 dark:border-slate-700 last:border-none">
                      <td className="px-3 py-3 font-medium text-slate-900 dark:text-white">{log.emp_code}</td>
                      <td className="px-3 py-3">{log.punch_time ? new Date(log.punch_time).toLocaleString('en-US') : '--'}</td>
                      <td className="px-3 py-3">{log.terminal || '—'}</td>
                      <td className="px-3 py-3">{normalizePunchState(log.punch_state)}</td>
                    </tr>
                  ));
                })()}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
