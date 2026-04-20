import { Card, CardHeader } from '../ui/Card';
import { formatCurrency, getMonthName } from '../../lib/payrollCalculator';

interface ChartData {
  month: number;
  year: number;
  total: number;
}

interface SalaryChartProps {
  data: ChartData[];
  loading?: boolean;
}

export function SalaryChart({ data, loading }: SalaryChartProps) {
  if (loading) {
    return (
      <Card>
        <div className="animate-pulse space-y-4">
          <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-1/3" />
          <div className="h-48 bg-slate-100 dark:bg-slate-700/50 rounded-lg" />
        </div>
      </Card>
    );
  }

  const maxVal = Math.max(...data.map(d => d.total), 1);

  return (
    <Card>
      <CardHeader
        title="Payroll Trend"
        subtitle="Monthly salary expenditure"
      />
      {data.length === 0 ? (
        <div className="h-48 flex items-center justify-center text-slate-400 text-sm">
          No payroll data available yet
        </div>
      ) : (
        <div className="h-48 flex items-end gap-3 pt-4">
          {data.map((d, i) => {
            const height = Math.max((d.total / maxVal) * 100, 4);
            return (
              <div key={i} className="flex-1 flex flex-col items-center gap-2 group">
                <div className="relative w-full flex flex-col items-center">
                  <span className="text-xs text-slate-500 dark:text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity absolute -top-5 whitespace-nowrap">
                    {formatCurrency(d.total)}
                  </span>
                  <div
                    className="w-full bg-blue-600 dark:bg-blue-500 hover:bg-blue-500 dark:hover:bg-blue-400 rounded-t-md transition-all duration-200 cursor-pointer"
                    style={{ height: `${(height / 100) * 11}rem` }}
                  />
                </div>
                <span className="text-xs text-slate-400 dark:text-slate-500 font-medium">
                  {getMonthName(d.month).slice(0, 3)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

interface DepartmentChartData {
  department: string;
  count: number;
  total: number;
}

interface DepartmentChartProps {
  data: DepartmentChartData[];
}

export function DepartmentChart({ data }: DepartmentChartProps) {
  const total = data.reduce((s, d) => s + d.count, 0) || 1;
  const colors = [
    'bg-blue-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500',
    'bg-cyan-500', 'bg-violet-500', 'bg-orange-500',
  ];

  return (
    <Card>
      <CardHeader title="Employees by Department" subtitle="Headcount distribution" />
      {data.length === 0 ? (
        <div className="h-32 flex items-center justify-center text-slate-400 text-sm">
          No data available
        </div>
      ) : (
        <div className="space-y-3">
          {data.map((d, i) => (
            <div key={d.department}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-slate-600 dark:text-slate-300 font-medium">{d.department || 'General'}</span>
                <span className="text-xs text-slate-500 dark:text-slate-400">{d.count} emp.</span>
              </div>
              <div className="h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-700 ${colors[i % colors.length]}`}
                  style={{ width: `${(d.count / total) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
