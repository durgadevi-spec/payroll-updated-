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

interface LeaveEntry {
  emp_code: string;
  leave_date: string;
  leave_type?: string;
  leave_duration_type?: string;
}

interface AttendanceSummary {
  employeeCode: string;
  date: string;
  dateKey: string;
  dayOfWeek: string;
  firstIn: string;
  lastOut: string;
  hours: string;
  rawCount: number;
  status: string;
  leaveType?: string;
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

// Builds a timezone-safe "YYYY-MM-DD" key from a Date using LOCAL time components.
// This avoids the classic bug where new Date("YYYY-MM-DD") is parsed as UTC
// while new Date(someLocalTimestamp) is parsed as local time, causing off-by-one
// day mismatches when filtering (especially in timezones ahead of UTC, like IST).
function toISODateKey(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Parses a "YYYY-MM-DD" key as a LOCAL calendar date (not UTC — new Date("YYYY-MM-DD")
// would parse as UTC and could shift to the previous/next day depending on timezone)
// and returns the weekday name, e.g. "Sunday".
function getWeekdayLabel(dateKey: string) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  return dt.toLocaleDateString('en-US', { weekday: 'long' });
}

// Builds a display date string ("M/D/YYYY") from a "YYYY-MM-DD" key, for rows that
// don't come from an actual punch timestamp (i.e. synthesized missing-day rows).
function displayDateFromKey(dateKey: string) {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1).toLocaleDateString('en-US');
}

// Returns every "YYYY-MM-DD" date between from and to (inclusive), both treated as
// local calendar dates.
function getDateRange(from: string, to: string): string[] {
  const dates: string[] = [];
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  const cursor = new Date(fy, (fm || 1) - 1, fd || 1);
  const end = new Date(ty, (tm || 1) - 1, td || 1);
  while (cursor.getTime() <= end.getTime()) {
    dates.push(toISODateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function getStatusBadgeClasses(status: string) {
  if (status === 'Complete') return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200';
  if (status === 'On Leave') return 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200';
  if (status === 'OD') return 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200';
  if (status === 'Sunday') return 'bg-slate-200 text-slate-700 dark:bg-slate-700/60 dark:text-slate-200';
  if (status === 'Incomplete') return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-200';
  return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-200'; // Missing Punch
}

function buildAttendanceSummary(
  logs: AttendanceLog[],
  leaveMap: Map<string, { leaveType?: string; leaveDurationType?: string }>
): AttendanceSummary[] {
  const groups: Record<string, AttendanceLog[]> = {};

  for (const log of logs) {
    const dateObj = new Date(log.punch_time);
    const dateKey = toISODateKey(dateObj);
    const key = `${log.emp_code}__${dateKey}`;
    groups[key] = groups[key] || [];
    groups[key].push(log);
  }

  return Object.entries(groups).map(([key, entries]) => {
    const [employeeCode, dateKey] = key.split('__');
    const sorted = [...entries].sort((a, b) => new Date(a.punch_time).getTime() - new Date(b.punch_time).getTime());

    const firstInEntry = sorted.find(log => normalizePunchState(log.punch_state) === 'IN') || sorted[0];
    // Only pick a different lastOut if there's more than one punch or a specific OUT punch
    const lastOutEntry = [...sorted].reverse().find(log => normalizePunchState(log.punch_state) === 'OUT') || (sorted.length > 1 ? sorted[sorted.length - 1] : null);

    const firstInTime = new Date(firstInEntry.punch_time);
    const lastOutTime = lastOutEntry ? new Date(lastOutEntry.punch_time) : null;
    const durationSeconds = (lastOutTime && lastOutTime.getTime() > firstInTime.getTime()) ? (lastOutTime.getTime() - firstInTime.getTime()) / 1000 : 0;

    // Display date kept in the original en-US format for the UI; dateKey (ISO,
    // local-time based) is used internally for filtering/sorting so it lines up
    // exactly with the <input type="date"> values without timezone drift.
    const displayDate = firstInEntry.punch_time ? new Date(firstInEntry.punch_time).toLocaleDateString('en-US') : dateKey;

    const isComplete = durationSeconds > 0;
    // Only bother checking approved leave when the punch record itself is
    // incomplete — a fully worked day is Complete regardless of any leave record.
    const leaveInfo = !isComplete ? leaveMap.get(`${employeeCode.toUpperCase()}__${dateKey}`) : undefined;
    // OD (On Duty) is tracked in the same LMS table as leave, but it isn't a leave —
    // it means the employee was working off-site, so it gets its own status rather
    // than being folded into "On Leave".
    const isOD = leaveInfo?.leaveType === 'OD';
    // This row always has at least one punch (rawCount >= 1) since it came from a
    // real log entry — so an unresolved day here is "Incomplete" (partial punch),
    // not "Missing Punch" (which is reserved for days with zero punches at all,
    // handled separately in buildMissingDayRows below).
    let status = isComplete ? 'Complete' : (leaveInfo ? (isOD ? 'OD' : 'On Leave') : 'Incomplete');
    let hours = isComplete
      ? formatDuration(durationSeconds)
      : (leaveInfo ? (isOD ? 'OD' : (leaveInfo.leaveType || 'On Leave')) : 'Incomplete');

    // Sunday is a weekly off, not an attendance problem — if the day would
    // otherwise be flagged "Incomplete" (no leave/OD covering it), show it as
    // "Sunday" instead so it doesn't read as something needing follow-up.
    const dayOfWeek = getWeekdayLabel(dateKey);
    if (dayOfWeek === 'Sunday' && status === 'Incomplete') {
      status = 'Sunday';
      hours = 'Sunday';
    }

    return {
      employeeCode,
      date: displayDate,
      dateKey,
      dayOfWeek,
      firstIn: firstInEntry.punch_time ? new Date(firstInEntry.punch_time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '--',
      lastOut: lastOutTime ? lastOutTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '--',
      hours,
      rawCount: sorted.length,
      status,
      leaveType: leaveInfo?.leaveType,
    };
  }).sort((a, b) => (a.dateKey > b.dateKey ? -1 : 1));
}

// Builds rows for days that have NO attendance punch at all (not even an incomplete
// one) within the selected date range, for the given employee(s) — so a day with
// zero punches shows up as "On Leave" (if an approved LMS leave covers it) or
// "Missing Punch" (if not), instead of silently not appearing in the table at all.
// Only runs when both fromDate and toDate are set, since it needs a bounded range
// to know which calendar days to check.
function buildMissingDayRows(
  existing: AttendanceSummary[],
  employeeCodes: string[],
  fromDate: string,
  toDate: string,
  leaveMap: Map<string, { leaveType?: string; leaveDurationType?: string }>
): AttendanceSummary[] {
  if (!fromDate || !toDate || employeeCodes.length === 0) return [];

  const existingKeys = new Set(existing.map(item => `${item.employeeCode.toUpperCase()}__${item.dateKey}`));
  const dateRange = getDateRange(fromDate, toDate);
  const rows: AttendanceSummary[] = [];

  for (const code of employeeCodes) {
    for (const dateKey of dateRange) {
      const key = `${code.toUpperCase()}__${dateKey}`;
      if (existingKeys.has(key)) continue; // already has at least one punch that day

      const leaveInfo = leaveMap.get(key);
      const isOD = leaveInfo?.leaveType === 'OD';
      const dayOfWeek = getWeekdayLabel(dateKey);
      let status = leaveInfo ? (isOD ? 'OD' : 'On Leave') : 'Missing Punch';
      let hours = leaveInfo ? (isOD ? 'OD' : (leaveInfo.leaveType || 'On Leave')) : 'Missing Punch';

      // Sunday is a weekly off, not an attendance problem — no need to flag a
      // punch-free Sunday as "Missing Punch".
      if (dayOfWeek === 'Sunday' && status === 'Missing Punch') {
        status = 'Sunday';
        hours = 'Sunday';
      }

      rows.push({
        employeeCode: code,
        date: displayDateFromKey(dateKey),
        dateKey,
        dayOfWeek,
        firstIn: '--',
        lastOut: '--',
        hours,
        rawCount: 0,
        status,
        leaveType: leaveInfo?.leaveType,
      });
    }
  }

  return rows;
}

export function Attendance() {
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [leaves, setLeaves] = useState<LeaveEntry[]>([]);
  const [employeeCodes, setEmployeeCodes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [selectedEmployee, setSelectedEmployee] = useState('all');

  useEffect(() => {
    loadAttendance();
  }, []);

  // Re-fetch from the server whenever the filters change. The backend now
  // supports ?from=&to=&emp_code= so we're no longer limited to whatever the
  // default 200-row (now 20,000-row, date-scoped) response happened to include —
  // this ensures a full month's data for a given employee is actually retrieved,
  // not just filtered client-side from a partial dataset.
  useEffect(() => {
    loadAttendance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromDate, toDate, selectedEmployee]);

  // Fetch the full employee dropdown list separately, scoped only to the date
  // range (never to selectedEmployee). This is what was collapsing the "Employee"
  // dropdown down to just the currently-selected employee before: the list used to
  // be derived from `logs`, which itself gets filtered server-side to just that one
  // employee once you pick them — so every other employee vanished from the list.
  useEffect(() => {
    loadEmployeeCodes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromDate, toDate]);

  // Map of "EMPCODE__YYYY-MM-DD" -> approved leave info from the LMS, used to tell
  // a genuinely missing punch apart from an approved day off.
  const leaveMap = useMemo(() => {
    const map = new Map<string, { leaveType?: string; leaveDurationType?: string }>();
    for (const lv of leaves) {
      if (!lv.emp_code || !lv.leave_date) continue;
      const dateKey = toISODateKey(new Date(lv.leave_date));
      const key = `${lv.emp_code.toUpperCase()}__${dateKey}`;
      map.set(key, { leaveType: lv.leave_type, leaveDurationType: lv.leave_duration_type });
    }
    return map;
  }, [leaves]);

  const summary = useMemo(() => buildAttendanceSummary(logs, leaveMap), [logs, leaveMap]);

  // Synthesize rows for days with zero punches at all (not even an incomplete one),
  // so they show up as "On Leave" or "Missing Punch" instead of just being absent
  // from the table. Scoped to the selected employee (or all currently-loaded
  // employee codes) and only within an explicit from/to range.
  const missingDayRows = useMemo(() => {
    const codes = selectedEmployee !== 'all' ? [selectedEmployee] : employeeCodes;
    return buildMissingDayRows(summary, codes, fromDate, toDate, leaveMap);
  }, [summary, selectedEmployee, employeeCodes, fromDate, toDate, leaveMap]);

  const completeSummary = useMemo(() => {
    return [...summary, ...missingDayRows].sort((a, b) => {
      if (a.dateKey !== b.dateKey) return a.dateKey > b.dateKey ? -1 : 1;
      return a.employeeCode.localeCompare(b.employeeCode);
    });
  }, [summary, missingDayRows]);

  // Apply filters
  const filteredSummary = useMemo(() => {
    let filtered = completeSummary;

    if (selectedEmployee !== 'all') {
      filtered = filtered.filter(item => item.employeeCode === selectedEmployee);
    }

    // fromDate/toDate come from <input type="date"> as "YYYY-MM-DD" strings.
    // item.dateKey is also "YYYY-MM-DD" (built from local date components), so
    // we compare them directly as strings — ISO date strings sort correctly
    // lexicographically and this sidesteps the UTC-vs-local Date parsing bug.
    if (fromDate) {
      filtered = filtered.filter(item => item.dateKey >= fromDate);
    }

    if (toDate) {
      filtered = filtered.filter(item => item.dateKey <= toDate);
    }

    return filtered;
  }, [completeSummary, selectedEmployee, fromDate, toDate]);

  async function loadEmployeeCodes() {
    try {
      const params = new URLSearchParams();
      if (fromDate) params.set('from', fromDate);
      if (toDate) params.set('to', toDate);
      const query = params.toString();

      const response = await fetch(`/api/attendance/employees${query ? `?${query}` : ''}`);
      if (!response.ok) return; // keep whatever list we already had rather than clearing it
      const codes = await response.json();
      setEmployeeCodes(Array.isArray(codes) ? codes.sort() : []);
    } catch (err) {
      console.error(err);
    }
  }

  async function loadAttendance() {
    setError('');
    setLoading(true);

    try {
      // Pass the current filters to the backend so it only queries the rows we
      // actually need, rather than relying on a fixed row cap that could silently
      // exclude older records for the selected date range/employee.
      const params = new URLSearchParams();
      if (fromDate) params.set('from', fromDate);
      if (toDate) params.set('to', toDate);
      if (selectedEmployee !== 'all') params.set('emp_code', selectedEmployee);
      const query = params.toString();

      const [logsResponse, leavesResponse] = await Promise.all([
        fetch(`/api/attendance/logs${query ? `?${query}` : ''}`),
        fetch(`/api/attendance/leaves${query ? `?${query}` : ''}`),
      ]);

      if (!logsResponse.ok) {
        const body = await logsResponse.text();
        throw new Error(body || 'Unable to load attendance logs');
      }
      const data = await logsResponse.json();
      setLogs(Array.isArray(data) ? data : []);

      // Leave data is supplementary — if the LMS lookup fails for any reason,
      // don't block the whole page; just proceed without leave cross-referencing.
      if (leavesResponse.ok) {
        const leaveData = await leavesResponse.json();
        setLeaves(Array.isArray(leaveData) ? leaveData : []);
      } else {
        setLeaves([]);
      }
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
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Needs attention</p>
            <p className="mt-3 text-2xl font-semibold text-slate-900 dark:text-white">{filteredSummary.filter(item => item.status === 'Incomplete' || item.status === 'Missing Punch').length}</p>
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
          <div className="text-sm text-slate-500 dark:text-slate-400">Showing {filteredSummary.length} of {completeSummary.length} records</div>
        </div>

        {loading ? (
          <TableSkeleton rows={6} cols={7} />
        ) : filteredSummary.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
            {completeSummary.length === 0 ? 'No attendance logs available yet. Click refresh to fetch data from the biometric API.' : 'No records match your filters.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-700 dark:text-slate-200">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-[0.2em] text-slate-500 dark:border-slate-700">
                  <th className="px-3 py-3">Employee Code</th>
                  <th className="px-3 py-3">Date</th>
                  <th className="px-3 py-3">Day</th>
                  <th className="px-3 py-3">First IN</th>
                  <th className="px-3 py-3">Last OUT</th>
                  <th className="px-3 py-3">Hours</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-3 py-3">Punches</th>
                </tr>
              </thead>
              <tbody>
                {filteredSummary.map(item => (
                  <tr key={`${item.employeeCode}-${item.dateKey}`} className="border-b border-slate-200 dark:border-slate-700 last:border-none">
                    <td className="px-3 py-3 font-medium text-slate-900 dark:text-white">{item.employeeCode}</td>
                    <td className="px-3 py-3">{item.date}</td>
                    <td className="px-3 py-3">{item.dayOfWeek}</td>
                    <td className="px-3 py-3">{item.firstIn}</td>
                    <td className="px-3 py-3">{item.lastOut}</td>
                    <td className="px-3 py-3">{item.hours}</td>
                    <td className="px-3 py-3 text-sm font-medium">
                      <span className={`inline-flex items-center rounded-full px-2 py-1 ${getStatusBadgeClasses(item.status)}`}>
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

                  // Use the same local-time ISO date key here as in buildAttendanceSummary
                  // so the raw transactions table stays consistent with the summary table
                  // and doesn't fall prey to the UTC-vs-local Date parsing mismatch.
                  const dateFilteredLogs = filteredLogs.filter(log => {
                    if (!log.punch_time) return true;
                    const logDateKey = toISODateKey(new Date(log.punch_time));
                    if (fromDate && logDateKey < fromDate) return false;
                    if (toDate && logDateKey > toDate) return false;
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