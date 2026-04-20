import { useEffect, useState } from 'react';
import { Users, DollarSign, FileText, CheckCircle, TrendingUp, Clock } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Employee, Payroll, AuditLog } from '../types';
import { formatCurrency, getCurrentMonth, getMonthName } from '../lib/payrollCalculator';
import { KPICard } from '../components/dashboard/KPICard';
import { SalaryChart, DepartmentChart } from '../components/dashboard/SalaryChart';
import { RecentActivity } from '../components/dashboard/RecentActivity';
import { Card, CardHeader } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';

export function Dashboard() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [payrolls, setPayrolls] = useState<Payroll[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const { month, year } = getCurrentMonth();

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    const [empRes, payRes, auditRes] = await Promise.all([
      supabase.from('employees').select('*').order('created_at', { ascending: false }),
      supabase.from('payrolls').select('*').order('year', { ascending: false }).order('month', { ascending: false }).limit(6),
      supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(10),
    ]);
    if (empRes.data) setEmployees(empRes.data);
    if (payRes.data) setPayrolls(payRes.data);
    if (auditRes.data) setAuditLogs(auditRes.data);
    setLoading(false);
  }

  const activeEmployees = employees.filter(e => e.status === 'active');
  const totalSalary = activeEmployees.reduce((s, e) => s + e.salary, 0);
  const currentPayroll = payrolls.find(p => p.month === month && p.year === year);
  const pendingPayslips = payrolls.filter(p => p.status !== 'paid').length;

  const chartData = [...payrolls]
    .sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month)
    .map(p => ({ month: p.month, year: p.year, total: p.total_amount }));

  const deptMap = new Map<string, number>();
  employees.forEach(e => {
    const dept = e.department || 'General';
    deptMap.set(dept, (deptMap.get(dept) || 0) + 1);
  });
  const deptData = Array.from(deptMap.entries()).map(([department, count]) => ({
    department, count, total: 0
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-800 dark:text-white">
            {getMonthName(month)} {year} Overview
          </h2>
          <p className="text-slate-500 dark:text-slate-400 text-sm mt-0.5">
            Payroll summary and workforce analytics
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={currentPayroll?.status === 'paid' ? 'success' : currentPayroll?.status === 'completed' ? 'info' : 'warning'} dot>
            {currentPayroll ? currentPayroll.status.charAt(0).toUpperCase() + currentPayroll.status.slice(1) : 'Not Generated'}
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        <KPICard
          title="Total Employees"
          value={String(activeEmployees.length)}
          subtitle={`${employees.filter(e => e.status === 'inactive').length} inactive`}
          icon={<Users size={20} className="text-blue-600" />}
          iconColor="bg-blue-100 dark:bg-blue-900/30"
          trend={{ value: 0, label: 'this month' }}
          loading={loading}
        />
        <KPICard
          title="Monthly Salary Budget"
          value={formatCurrency(totalSalary)}
          subtitle={`Avg: ${formatCurrency(activeEmployees.length ? totalSalary / activeEmployees.length : 0)}/emp`}
          icon={<DollarSign size={20} className="text-emerald-600" />}
          iconColor="bg-emerald-100 dark:bg-emerald-900/30"
          loading={loading}
        />
        <KPICard
          title="Pending Payrolls"
          value={String(pendingPayslips)}
          subtitle="Awaiting disbursement"
          icon={<FileText size={20} className="text-amber-600" />}
          iconColor="bg-amber-100 dark:bg-amber-900/30"
          loading={loading}
        />
        <KPICard
          title="Payroll Status"
          value={currentPayroll ? currentPayroll.status.toUpperCase() : 'PENDING'}
          subtitle={`${getMonthName(month)} ${year}`}
          icon={<CheckCircle size={20} className="text-cyan-600" />}
          iconColor="bg-cyan-100 dark:bg-cyan-900/30"
          loading={loading}
        />
        <KPICard
          title="Team Productivity"
          value="92%"
          subtitle="Based on timesheet data"
          icon={<TrendingUp size={20} className="text-rose-600" />}
          iconColor="bg-rose-100 dark:bg-rose-900/30"
          trend={{ value: 3.2, label: 'vs last month' }}
          loading={loading}
        />
        <KPICard
          title="Avg Processing Time"
          value="< 2 min"
          subtitle="Payroll generation speed"
          icon={<Clock size={20} className="text-orange-600" />}
          iconColor="bg-orange-100 dark:bg-orange-900/30"
          loading={loading}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SalaryChart data={chartData} loading={loading} />
        <DepartmentChart data={deptData} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <Card padding={false}>
            <div className="p-5 border-b border-slate-200 dark:border-slate-700">
              <CardHeader title="Employee Overview" subtitle="Active workforce snapshot" />
            </div>
            <div className="overflow-x-auto">
              {loading ? (
                <div className="p-5 space-y-3">
                  {[1, 2, 3].map(i => (
                    <div key={i} className="flex gap-4 animate-pulse">
                      <div className="w-8 h-8 bg-slate-200 dark:bg-slate-700 rounded-full" />
                      <div className="flex-1 space-y-1.5">
                        <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded w-1/3" />
                        <div className="h-3 bg-slate-100 dark:bg-slate-700/60 rounded w-1/4" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 dark:border-slate-700/50">
                      <th className="text-left py-3 px-5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Employee</th>
                      <th className="text-left py-3 px-5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider hidden sm:table-cell">Department</th>
                      <th className="text-right py-3 px-5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Salary</th>
                      <th className="text-center py-3 px-5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {employees.slice(0, 8).map(emp => (
                      <tr key={emp.id} className="border-b border-slate-50 dark:border-slate-700/30 hover:bg-slate-50/50 dark:hover:bg-slate-700/20 transition-colors">
                        <td className="py-3 px-5">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                              {emp.name.charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <p className="font-medium text-slate-700 dark:text-slate-200 text-xs">{emp.name}</p>
                              <p className="text-slate-400 text-xs">{emp.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-5 hidden sm:table-cell">
                          <span className="text-xs text-slate-500 dark:text-slate-400">{emp.department || '—'}</span>
                        </td>
                        <td className="py-3 px-5 text-right">
                          <span className="font-semibold text-slate-700 dark:text-slate-200 text-xs">{formatCurrency(emp.salary)}</span>
                        </td>
                        <td className="py-3 px-5 text-center">
                          <Badge variant={emp.status === 'active' ? 'success' : 'neutral'} dot>
                            {emp.status}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                    {employees.length === 0 && (
                      <tr>
                        <td colSpan={4} className="py-8 text-center text-slate-400 text-sm">
                          No employees found
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </Card>
        </div>

        <RecentActivity logs={auditLogs} loading={loading} />
      </div>
    </div>
  );
}
