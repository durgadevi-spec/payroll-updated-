import { ReactNode } from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { Card } from '../ui/Card';

interface KPICardProps {
  title: string;
  value: string;
  subtitle?: string;
  icon: ReactNode;
  iconColor: string;
  trend?: { value: number; label: string };
  loading?: boolean;
}

export function KPICard({ title, value, subtitle, icon, iconColor, trend, loading }: KPICardProps) {
  if (loading) {
    return (
      <Card>
        <div className="animate-pulse space-y-3">
          <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded w-2/3" />
          <div className="h-7 bg-slate-200 dark:bg-slate-700 rounded w-1/2" />
          <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded w-3/4" />
        </div>
      </Card>
    );
  }

  return (
    <Card className="hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 border-slate-100/50 dark:border-slate-700/30">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">{title}</p>
          <p className="text-2xl font-extrabold text-slate-800 dark:text-white mt-1.5 tracking-tight">{value}</p>
          {subtitle && (
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5 flex items-center gap-1.5">
              <span className="w-1 h-1 rounded-full bg-slate-300 dark:bg-slate-600" />
              {subtitle}
            </p>
          )}
          {trend && (
            <div className={`flex items-center gap-1.5 mt-2.5 px-2 py-0.5 rounded-full w-fit text-[10px] font-bold ${trend.value >= 0 ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400' : 'bg-red-50 dark:bg-red-900/20 text-red-500 dark:text-red-400'}`}>
              {trend.value >= 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
              <span>{Math.abs(trend.value)}% {trend.label}</span>
            </div>
          )}
        </div>
        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 ml-4 shadow-inner ${iconColor} transition-transform duration-300 group-hover:scale-110`}>
          {icon}
        </div>
      </div>
    </Card>
  );
}
