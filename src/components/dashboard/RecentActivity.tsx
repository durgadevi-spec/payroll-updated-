import { AuditLog } from '../../types';
import { Card, CardHeader } from '../ui/Card';
import { Clock, UserPlus, Calculator, FileText, Mail, Settings } from 'lucide-react';

const actionIcons: Record<string, React.ReactNode> = {
  CREATE_EMPLOYEE: <UserPlus size={14} />,
  GENERATE_PAYROLL: <Calculator size={14} />,
  GENERATE_PAYSLIP: <FileText size={14} />,
  SEND_EMAIL: <Mail size={14} />,
  UPDATE_SETTINGS: <Settings size={14} />,
};

const actionColors: Record<string, string> = {
  CREATE_EMPLOYEE: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400',
  GENERATE_PAYROLL: 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400',
  GENERATE_PAYSLIP: 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400',
  SEND_EMAIL: 'bg-cyan-100 dark:bg-cyan-900/30 text-cyan-600 dark:text-cyan-400',
  UPDATE_SETTINGS: 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400',
};

interface RecentActivityProps {
  logs: AuditLog[];
  loading?: boolean;
}

export function RecentActivity({ logs, loading }: RecentActivityProps) {
  return (
    <Card>
      <CardHeader title="Recent Activity" subtitle="Latest system actions" />
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="flex gap-3 animate-pulse">
              <div className="w-8 h-8 rounded-lg bg-slate-200 dark:bg-slate-700 flex-shrink-0" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded w-3/4" />
                <div className="h-3 bg-slate-100 dark:bg-slate-700/60 rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : logs.length === 0 ? (
        <div className="py-8 flex flex-col items-center text-slate-400 gap-2">
          <Clock size={28} className="opacity-40" />
          <p className="text-sm">No activity yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {logs.map(log => (
            <div key={log.id} className="flex items-start gap-3">
              <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${actionColors[log.action] || 'bg-slate-100 dark:bg-slate-700 text-slate-500'}`}>
                {actionIcons[log.action] || <Clock size={12} />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-slate-700 dark:text-slate-200 leading-snug">
                  {log.action.replace(/_/g, ' ').toLowerCase().replace(/^\w/, c => c.toUpperCase())}
                </p>
                <p className="text-xs text-slate-400 mt-0.5">
                  {new Date(log.created_at).toLocaleString('en-IN', {
                    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
                  })}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
