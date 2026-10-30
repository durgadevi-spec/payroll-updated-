import { useEffect, useState } from 'react';
import { CalendarClock, Save, Play } from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../context/AuthContext';
import { Button } from '../ui/Button';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

interface Status {
  config: { enabled: boolean; day: number; enabledAt: string | null };
  nextRun: { date: string; payrollMonth: number; payrollYear: number } | null;
  recentRuns: { month: number; year: number; status: string; message: string | null; finished_at: string | null }[];
}

const statusStyle: Record<string, string> = {
  completed: 'text-emerald-600 dark:text-emerald-400',
  skipped: 'text-slate-500 dark:text-slate-400',
  failed: 'text-red-600 dark:text-red-400',
  running: 'text-amber-600 dark:text-amber-400',
};

export function AutoPayrollSettings() {
  const { showToast } = useToast();
  const auth = useAuth() as any;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [day, setDay] = useState(2);
  const [status, setStatus] = useState<Status | null>(null);

  function apply(s: Status) {
    setStatus(s);
    setEnabled(s.config.enabled);
    setDay(s.config.day);
  }

  async function load() {
    try {
      const res = await fetch('/api/auto-payroll/settings');
      if (!res.ok) throw new Error();
      apply(await res.json());
    } catch {
      showToast('error', 'Failed to load auto payroll settings');
    }
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch('/api/auto-payroll/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled, day, user_email: auth?.user?.email || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      apply(data);
      showToast('success', 'Auto payroll settings saved');
    } catch (e: any) {
      showToast('error', e.message || 'Failed to save auto payroll settings');
    }
    setSaving(false);
  }

  async function runNow() {
    if (!confirm('Run the automatic payroll check now? If the previous month has no payroll yet, it will be generated.')) return;
    setRunning(true);
    try {
      const res = await fetch('/api/auto-payroll/run-now', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const map: Record<string, string> = {
        completed: 'Payroll generated successfully',
        skipped: 'Payroll for that month already exists — nothing to do',
        already_handled: 'That month was already handled automatically',
        busy: 'A run is already in progress',
        failed: `Generation failed: ${data.error || 'see server logs'}`,
      };
      showToast(data.status === 'failed' ? 'error' : 'success', map[data.status] || 'Done');
      await load();
    } catch (e: any) {
      showToast('error', e.message || 'Run failed');
    }
    setRunning(false);
  }

  if (loading) return <div className="h-32 animate-pulse bg-slate-200 dark:bg-slate-700 rounded" />;

  const prev = (() => {
    const now = new Date();
    const m = now.getMonth() === 0 ? 12 : now.getMonth();
    return MONTHS[m - 1];
  })();

  return (
    <div className="space-y-5 max-w-2xl">
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center">
          <CalendarClock size={15} className="text-indigo-600 dark:text-indigo-400" />
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-800 dark:text-white">Auto-Generate Payroll</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">Automatically generate the previous month's payroll on a fixed day each month</p>
        </div>
      </div>

      <div className="flex items-start justify-between gap-4 p-4 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
        <div>
          <p className="text-sm font-medium text-slate-800 dark:text-slate-100">Enable automatic payroll generation</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Uses the same calculation as manual Generate Payroll. A month that already has a payroll is never regenerated.</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={() => setEnabled(v => !v)}
          className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${enabled ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-slate-600'}`}
        >
          <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
        </button>
      </div>

      <div className={enabled ? '' : 'opacity-60'}>
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Generate on day of month</label>
        <select
          value={day}
          disabled={!enabled}
          onChange={e => setDay(Number(e.target.value))}
          className="w-40 px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100"
        >
          {Array.from({ length: 31 }, (_, i) => i + 1).map(d => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5">
          On day {day} of every month, the previous month's payroll is generated (this month: {prev}). Days 29–31 run on the last day of shorter months. Times are India Standard Time.
        </p>
      </div>

      {status?.config.enabled && status.nextRun && (
        <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-xs text-blue-700 dark:text-blue-300">
          Next automatic run: <b>{status.nextRun.date}</b> → {MONTHS[status.nextRun.payrollMonth - 1]} {status.nextRun.payrollYear} payroll
        </div>
      )}

      <div className="flex gap-3">
        <Button icon={<Save size={15} />} loading={saving} onClick={save}>Save Auto Payroll Settings</Button>
        <Button variant="outline" icon={<Play size={14} />} loading={running} onClick={runNow}>Run check now</Button>
      </div>

      {status && status.recentRuns.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-slate-700 dark:text-slate-200 mb-2">Recent automatic runs</p>
          <div className="divide-y divide-slate-100 dark:divide-slate-700 border border-slate-200 dark:border-slate-700 rounded-lg">
            {status.recentRuns.map(r => (
              <div key={`${r.year}-${r.month}`} className="flex items-center justify-between px-3 py-2 text-xs">
                <span className="text-slate-700 dark:text-slate-200">{MONTHS[r.month - 1]} {r.year}</span>
                <span className={`font-medium capitalize ${statusStyle[r.status] || ''}`} title={r.message || ''}>{r.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}