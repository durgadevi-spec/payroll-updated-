import { useState, useEffect } from 'react';
import { BarChart3, Download, FileSpreadsheet, TrendingUp, Users, Calendar } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useToast } from '../context/ToastContext';
import { formatCurrency, getMonthName } from '../lib/payrollCalculator';
import { Card, CardHeader } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Select } from '../components/ui/Input';

interface PayrollSummary {
  id: string;
  month: number;
  year: number;
  status: string;
  total_amount: number;
  employee_count: number;
}

export function Reports() {
  const { showToast } = useToast();
  const [payrolls, setPayrolls] = useState<PayrollSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [reportType, setReportType] = useState('monthly');
  const [selectedYear, setSelectedYear] = useState('2026');

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    const { data } = await supabase.from('payrolls').select('*').order('year', { ascending: false }).order('month', { ascending: false });
    setPayrolls(data || []);
    setLoading(false);
  }

  function exportCSV() {
    const filteredData = payrolls.filter(p => String(p.year) === selectedYear);
    const rows = [
      ['Month', 'Year', 'Employees', 'Total Amount', 'Status'],
      ...filteredData.map(p => [
        getMonthName(p.month), p.year, p.employee_count, p.total_amount, p.status
      ])
    ];
    const csv = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `payroll-report-${selectedYear}.csv`;
    a.click();
    showToast('success', 'CSV report downloaded');
  }

  const filteredPayrolls = payrolls.filter(p => String(p.year) === selectedYear);
  const totalAnnual = filteredPayrolls.reduce((s, p) => s + p.total_amount, 0);
  const avgMonthly = filteredPayrolls.length > 0 ? totalAnnual / filteredPayrolls.length : 0;
  const paidCount = filteredPayrolls.filter(p => p.status === 'paid').length;

  const reportTypes = [
    { value: 'monthly', label: 'Monthly Payroll Report' },
    { value: 'salary', label: 'Salary History' },
    { value: 'deduction', label: 'Deduction Report' },
  ];

  const yearOptions = ['2024', '2025', '2026', '2027'].map(y => ({ value: y, label: y }));

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1 flex gap-3">
          <div className="w-48">
            <Select
              value={reportType}
              onChange={e => setReportType(e.target.value)}
              options={reportTypes}
            />
          </div>
          <div className="w-28">
            <Select
              value={selectedYear}
              onChange={e => setSelectedYear(e.target.value)}
              options={yearOptions}
            />
          </div>
        </div>
        <Button icon={<Download size={15} />} variant="secondary" onClick={exportCSV}>
          Export CSV
        </Button>
        <Button icon={<FileSpreadsheet size={15} />} onClick={() => showToast('info', 'Excel export coming soon')}>
          Export Excel
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
              <BarChart3 size={18} className="text-blue-600" />
            </div>
            <div>
              <p className="text-xs text-slate-400">Annual Total ({selectedYear})</p>
              <p className="font-bold text-slate-800 dark:text-white">{formatCurrency(totalAnnual)}</p>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
              <TrendingUp size={18} className="text-emerald-600" />
            </div>
            <div>
              <p className="text-xs text-slate-400">Avg Monthly Payroll</p>
              <p className="font-bold text-slate-800 dark:text-white">{formatCurrency(avgMonthly)}</p>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
              <Calendar size={18} className="text-amber-600" />
            </div>
            <div>
              <p className="text-xs text-slate-400">Payrolls Completed</p>
              <p className="font-bold text-slate-800 dark:text-white">{paidCount} / {filteredPayrolls.length}</p>
            </div>
          </div>
        </Card>
      </div>

      <Card padding={false}>
        <div className="p-4 border-b border-slate-200 dark:border-slate-700">
          <CardHeader
            title={`Monthly Payroll Report — ${selectedYear}`}
            subtitle="Annual summary of payroll runs"
          />
        </div>
        <div className="overflow-x-auto">
          {loading ? (
            <div className="p-5 space-y-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="flex gap-4 animate-pulse">
                  {[1, 2, 3, 4, 5].map(j => <div key={j} className="h-8 flex-1 bg-slate-200 dark:bg-slate-700 rounded" />)}
                </div>
              ))}
            </div>
          ) : filteredPayrolls.length === 0 ? (
            <div className="py-16 text-center">
              <BarChart3 size={36} className="mx-auto text-slate-300 dark:text-slate-600 mb-3" />
              <p className="text-slate-500 dark:text-slate-400 text-sm">No reports for {selectedYear}</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-700">
                  {['Month', 'Year', 'Employees', 'Total Payroll', 'Status', 'Paid On'].map(h => (
                    <th key={h} className="py-3 px-4 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider text-left">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredPayrolls.map(p => (
                  <tr key={p.id} className="border-b border-slate-50 dark:border-slate-700/30 hover:bg-slate-50/50 dark:hover:bg-slate-700/20">
                    <td className="py-3 px-4 font-medium text-slate-700 dark:text-slate-200 text-xs">{getMonthName(p.month)}</td>
                    <td className="py-3 px-4 text-xs text-slate-500 dark:text-slate-400">{p.year}</td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                        <Users size={12} />
                        {p.employee_count}
                      </div>
                    </td>
                    <td className="py-3 px-4 font-semibold text-slate-700 dark:text-slate-200 text-xs">{formatCurrency(p.total_amount)}</td>
                    <td className="py-3 px-4">
                      <Badge variant={p.status === 'paid' ? 'success' : p.status === 'completed' ? 'info' : 'warning'} dot>
                        {p.status}
                      </Badge>
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-400">—</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800/50">
                  <td colSpan={3} className="py-3 px-4 font-semibold text-slate-700 dark:text-slate-200 text-xs">Total ({selectedYear})</td>
                  <td className="py-3 px-4 font-bold text-slate-800 dark:text-white text-sm">{formatCurrency(totalAnnual)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </Card>
    </div>
  );
}
