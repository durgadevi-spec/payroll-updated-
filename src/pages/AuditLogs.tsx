import { useState, useEffect } from 'react';
import { ClipboardList, RefreshCw, Search } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { TableSkeleton } from '../components/ui/Skeleton';
import { AuditLog } from '../types';

const actionVariants: Record<string, 'success' | 'info' | 'warning' | 'error' | 'neutral'> = {
  CREATE_EMPLOYEE: 'success',
  UPDATE_EMPLOYEE: 'info',
  DELETE_EMPLOYEE: 'error',
  GENERATE_PAYROLL: 'info',
  SEND_EMAIL: 'success',
  UPDATE_SETTINGS: 'warning',
  GENERATE_PAYSLIP: 'neutral',
};

export function AuditLogs() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => { loadLogs(); }, []);

  async function loadLogs() {
    setLoading(true);
    const { data } = await supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(200);
    setLogs(data || []);
    setLoading(false);
  }

  const filtered = logs.filter(l =>
    !search ||
    l.action.toLowerCase().includes(search.toLowerCase()) ||
    l.entity.toLowerCase().includes(search.toLowerCase()) ||
    l.user_email?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-5">
      <p className="text-slate-500 dark:text-slate-400 text-sm">Complete audit trail of all system actions</p>

      <div className="flex gap-3">
        <div className="flex-1 relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by action, entity, or user..."
            className="w-full pl-9 pr-4 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
          />
        </div>
        <Button variant="ghost" size="sm" icon={<RefreshCw size={13} />} onClick={loadLogs}>Refresh</Button>
      </div>

      <Card padding={false}>
        <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
          <p className="font-semibold text-slate-800 dark:text-white text-sm">Audit Trail</p>
          <span className="text-xs text-slate-400">{filtered.length} records</span>
        </div>

        <div className="overflow-x-auto">
          {loading ? (
            <div className="p-5"><TableSkeleton rows={5} cols={5} /></div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center">
              <ClipboardList size={36} className="mx-auto text-slate-300 dark:text-slate-600 mb-3" />
              <p className="text-slate-500 dark:text-slate-400 text-sm">No audit logs found</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-700">
                  {['Action', 'Entity', 'User', 'Details', 'Timestamp'].map(h => (
                    <th key={h} className="py-3 px-4 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider text-left">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(log => (
                  <tr key={log.id} className="border-b border-slate-50 dark:border-slate-700/30 hover:bg-slate-50/50 dark:hover:bg-slate-700/20">
                    <td className="py-3 px-4">
                      <Badge variant={actionVariants[log.action] || 'neutral'}>
                        {log.action.replace(/_/g, ' ')}
                      </Badge>
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-500 dark:text-slate-400 capitalize">{log.entity.replace(/_/g, ' ')}</td>
                    <td className="py-3 px-4 text-xs text-slate-600 dark:text-slate-300">{log.user_email || '—'}</td>
                    <td className="py-3 px-4 text-xs text-slate-400 max-w-xs truncate">
                      {log.details ? JSON.stringify(log.details).replace(/[{}"\[\]]/g, '').slice(0, 60) : '—'}
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-400 whitespace-nowrap">
                      {new Date(log.created_at).toLocaleString('en-IN', {
                        day: 'numeric', month: 'short', year: 'numeric',
                        hour: '2-digit', minute: '2-digit'
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>
    </div>
  );
}
