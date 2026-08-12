import { useState, useEffect } from 'react';
import { Clock3, Search, AlertCircle } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';

export function MyAttendance() {
  const { user } = useAuth();
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [month, setMonth] = useState((new Date().getMonth() + 1).toString());
  const [year, setYear] = useState(new Date().getFullYear().toString());

  useEffect(() => {
    fetchAttendance();
  }, [month, year]);

  async function fetchAttendance() {
    setLoading(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const res = await fetch(`/api/me/attendance?month=${month}&year=${year}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setLogs(data || []);
      }
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  }

  // Group logs by date
  const groupedLogs = logs.reduce((acc, log) => {
    const d = new Date(log.punch_time);
    const dateStr = d.toLocaleDateString('en-US');
    if (!acc[dateStr]) acc[dateStr] = [];
    acc[dateStr].push(d);
    return acc;
  }, {} as Record<string, Date[]>);

  const sortedDates = Object.keys(groupedLogs).sort((a, b) => new Date(b).getTime() - new Date(a).getTime());

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">My Attendance</h1>
          <p className="text-slate-500 text-sm mt-1">View your biometric punch logs</p>
        </div>
        <div className="flex items-center gap-3">
          <select 
            value={month} 
            onChange={e => setMonth(e.target.value)}
            className="px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 focus:ring-2 focus:ring-blue-500 text-sm"
          >
            {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
              <option key={m} value={m}>{new Date(2000, m - 1, 1).toLocaleString('default', { month: 'long' })}</option>
            ))}
          </select>
          <select 
            value={year} 
            onChange={e => setYear(e.target.value)}
            className="px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 focus:ring-2 focus:ring-blue-500 text-sm"
          >
            {[...Array(5)].map((_, i) => {
              const y = new Date().getFullYear() - 2 + i;
              return <option key={y} value={y}>{y}</option>;
            })}
          </select>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-50 dark:bg-slate-800/80 text-slate-500 dark:text-slate-400 uppercase text-xs">
              <tr>
                <th className="px-6 py-4 font-medium">Date</th>
                <th className="px-6 py-4 font-medium">First In</th>
                <th className="px-6 py-4 font-medium">Last Out</th>
                <th className="px-6 py-4 font-medium">Total Punches</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700/50 text-slate-700 dark:text-slate-300">
              {loading ? (
                <tr><td colSpan={4} className="px-6 py-8 text-center text-slate-500">Loading attendance...</td></tr>
              ) : sortedDates.length === 0 ? (
                <tr><td colSpan={4} className="px-6 py-8 text-center text-slate-500">No attendance logs found for this period</td></tr>
              ) : sortedDates.map((date) => {
                const dayLogs = groupedLogs[date].sort((a, b) => a.getTime() - b.getTime());
                const firstIn = dayLogs[0];
                const lastOut = dayLogs.length > 1 ? dayLogs[dayLogs.length - 1] : null;

                return (
                  <tr key={date} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                    <td className="px-6 py-4">
                      <p className="font-medium text-slate-900 dark:text-white">{date}</p>
                      <p className="text-xs text-slate-500">{new Date(date).toLocaleDateString('en-US', { weekday: 'long' })}</p>
                    </td>
                    <td className="px-6 py-4">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                        <Clock3 size={14} />
                        {firstIn.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      {lastOut ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
                          <Clock3 size={14} />
                          {lastOut.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      ) : (
                        <span className="text-slate-400 text-xs italic">No OUT punch</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <span className="font-medium text-slate-700 dark:text-slate-300">{dayLogs.length}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
