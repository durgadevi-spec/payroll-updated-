import React, { useState, useEffect, useCallback } from 'react';
import { Calculator, Play, ChevronDown, ChevronUp, CheckCircle2, DollarSign, AlertTriangle, Trash2, Eye, Edit2 } from 'lucide-react';
import { Payroll as PayrollType, PayrollItem, Employee, Leave, Timesheet } from '../types';
import { supabase } from '../lib/supabase';
import { useToast } from '../context/ToastContext';
import { calculatePayroll, formatCurrency, getCurrentMonth, getMonthName } from '../lib/payrollCalculator';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Modal } from '../components/ui/Modal';
import { Badge } from '../components/ui/Badge';
import { TableSkeleton } from '../components/ui/Skeleton';
import { Select } from '../components/ui/Input';

interface PayrollItemWithEmployee extends PayrollItem {
  employee: Employee;
}

export function Payroll() {
  const { showToast } = useToast();
  const [payrolls, setPayrolls] = useState<PayrollType[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [selectedPayroll, setSelectedPayroll] = useState<PayrollType | null>(null);
  const [payrollItems, setPayrollItems] = useState<PayrollItemWithEmployee[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [analysisPayroll, setAnalysisPayroll] = useState<PayrollType | null>(null);
  const [analysisItems, setAnalysisItems] = useState<(PayrollItemWithEmployee & { leave_source?: string; timesheet_status?: string; timesheet_submitted_at?: string | null })[]>([]);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const { month: currentMonth, year: currentYear } = getCurrentMonth();
  const [genMonth, setGenMonth] = useState(currentMonth);
  const [genYear, setGenYear] = useState(currentYear);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const [editingItem, setEditingItem] = useState<(PayrollItemWithEmployee & { leave_source?: string; timesheet_status?: string; timesheet_submitted_at?: string | null }) | null>(null);
  const [advanceInput, setAdvanceInput] = useState('0');
  const [sundayInput, setSundayInput] = useState('0');
  const [bonusInput, setBonusInput] = useState('0');
  const [calculationType, setCalculationType] = useState<'monthly' | 'custom' | 'working_days'>('monthly');
  const [customDaysInput, setCustomDaysInput] = useState('30');

  const countSundays = (month: number, year: number) => {
    let sundays = 0;
    const daysInMonth = new Date(year, month, 0).getDate();
    for (let day = 1; day <= daysInMonth; day++) {
      if (new Date(year, month - 1, day).getDay() === 0) {
        sundays++;
      }
    }
    return sundays;
  };

  const loadPayrolls = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('payrolls').select('*').order('year', { ascending: false }).order('month', { ascending: false });
    setPayrolls(data || []);
    setLoading(false);
  }, []);

  const loadEmployees = useCallback(async () => {
    const { data } = await supabase.from('employees').select('*').eq('status', 'active').order('name');
    const currentEmployees = (data || []) as Employee[];

    if (currentEmployees.length === 0) {
      await fetch('/api/employees/sync-timesheet', { method: 'POST' });
      const { data: syncedData } = await supabase.from('employees').select('*').eq('status', 'active').order('name');
      setEmployees((syncedData || []) as Employee[]);
      return;
    }

    setEmployees(currentEmployees);
  }, []);

  useEffect(() => {
    loadPayrolls();
    loadEmployees();
  }, [loadPayrolls, loadEmployees]);

  async function loadPayrollItems(payrollId: string) {
    setLoadingItems(true);
    try {
      const response = await fetch(`/api/payroll-items/analysis/${payrollId}`);
      if (!response.ok) {
        const message = await response.text();
        throw new Error(`Failed to load payroll details: ${response.status} ${message}`);
      }
      const data = await response.json();
      setPayrollItems((data as PayrollItemWithEmployee[]) || []);
    } catch (error) {
      console.error('Error loading payroll details:', error);
      setPayrollItems([]);
    }
    setLoadingItems(false);
  }

  async function loadPayrollAnalysis(payroll: PayrollType) {
    setAnalysisPayroll(payroll);
    setAnalysisLoading(true);

    try {
      const response = await fetch(`/api/payroll-items/analysis/${payroll.id}`);
      if (!response.ok) {
        const message = await response.text();
        throw new Error(`Failed to load payroll analysis: ${response.status} ${message}`);
      }
      const data = await response.json();
      setAnalysisItems((data as (PayrollItemWithEmployee & { leave_source?: string; timesheet_status?: string; timesheet_submitted_at?: string | null })[]) || []);
    } catch (error) {
      console.error('Error loading payroll analysis:', error);
      setAnalysisItems([]);
    }

    setAnalysisLoading(false);
  }

  async function updatePayrollItem() {
    if (!editingItem) return;
    try {
      const response = await fetch(`/api/payroll-items/${editingItem.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // advance_deduction is NOT sent — it's auto-managed from Advance Management
          sunday_work_days: parseFloat(sundayInput) || 0,
          bonus: parseFloat(bonusInput) || 0
        })
      });
      
      if (!response.ok) throw new Error('Failed to update item');
      
      showToast('success', 'Payroll item updated successfully');
      setEditingItem(null);
      if (analysisPayroll) await loadPayrollAnalysis(analysisPayroll);
      await loadPayrolls();
    } catch (err) {
      showToast('error', 'Update failed');
    }
  }

  async function generatePayroll() {
    // Allow multiple payrolls for the same month/year to support individual employee runs

    setGenerating(true);
    try {
      const { data: employeesData } = await supabase.from('employees').select('*').eq('status', 'active');
      const employeesList = (employeesData || []) as Employee[];
      const filteredEmployees = selectedEmployeeId
        ? employeesList.filter(employee => employee.id === selectedEmployeeId)
        : employeesList;

      if (filteredEmployees.length === 0) {
        showToast('warning', 'No active employee found for payroll generation');
        setGenerating(false);
        setShowGenerateModal(false);
        return;
      }

      const { data: settingsData } = await supabase.from('settings').select('*');

      const settings = Object.fromEntries((settingsData || []).map(s => [s.key, s.value || '']));
      const pfRate = parseFloat(settings.pf_rate || '12');
      const esiRate = parseFloat(settings.esi_rate || '0.75');
      const esiLimit = parseFloat(settings.esi_limit || '21000');
      const taxRate = parseFloat(settings.tax_rate || '10');
      const workingDays = parseInt(settings.working_days || '26');

      const { data: newPayroll } = await supabase
        .from('payrolls')
        .insert({ month: genMonth, year: genYear, status: 'processing', employee_count: filteredEmployees.length, generated_at: new Date().toISOString() })
        .select()
        .single();

      if (!newPayroll) throw new Error('Failed to create payroll');

      let totalAmount = 0;
      const items = [];

      const employeeIds = filteredEmployees.map(emp => emp.id);
      const externalResponse = await fetch('/api/payroll-items/external-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeIds, month: genMonth, year: genYear }),
      });

      const externalData = externalResponse.ok ? await externalResponse.json() : { leaves: [], timesheets: [], holidayCount: 0 };
      const leaveMap = new Map((externalData.leaves || []).map((leave: { employee_id: string }) => [leave.employee_id, leave]));
      const timesheetMap = new Map((externalData.timesheets || []).map((ts: { employee_id: string }) => [ts.employee_id, ts]));
      const holidayCount = externalData.holidayCount || 0;

      // Fetch approved advances for the payroll month from Advance Management
      const { data: advancesData } = await supabase
        .from('advances')
        .select('employee_id, installment_amount, balance, status, repayment_type')
        .eq('status', 'Active')
        .gt('balance', 0);
      const advanceByEmp = new Map<string, number>();
      (advancesData || []).forEach((adv: any) => {
        const inst = parseFloat(adv.installment_amount || 0);
        const bal = parseFloat(adv.balance || 0);
        // If One-time or installment is not set, take the full balance.
        const deduction = (adv.repayment_type === 'One-time' || inst === 0) ? bal : Math.min(inst, bal);
        if (deduction > 0) {
          advanceByEmp.set(adv.employee_id, (advanceByEmp.get(adv.employee_id) || 0) + deduction);
        }
      });

      // Actual days in the payroll month (e.g. April=30, March=31, Feb=28/29)
      const calendarDays = new Date(genYear, genMonth, 0).getDate();

      for (const emp of filteredEmployees) {
        const leaveData = leaveMap.get(emp.id);
        const tsData = timesheetMap.get(emp.id);
        const unpaidLeaves = leaveData?.unpaid_leaves || 0;
        // Default to 0 missing days — absence of TS data does NOT mean full month missing
        const missingTimesheets = tsData?.missing_days ?? 0;
        const advanceDeduction = advanceByEmp.get(emp.id) || 0;

        const monthlySalary = emp.ctc / 12;
        
        // Dynamic working days calculation if 'working_days' mode is selected
        let effectiveWorkingDays = workingDays;
        if (calculationType === 'working_days') {
          const totalDays = new Date(genYear, genMonth, 0).getDate();
          const sundays = countSundays(genMonth, genYear);
          effectiveWorkingDays = totalDays - sundays;
        }

        const calc = calculatePayroll({
          monthlySalary,
          workingDays: effectiveWorkingDays,
          calendarDays,        // Actual days of month for accurate per-day rate
          unpaidLeaves,
          missingTimesheets,
          bonus: 0,
          pfRate,
          esiRate,
          esiLimit,
          taxRate,
          loanDeduction: 0,
          advanceDeduction,
          sundayWorkDays: 0,
          calculationType: calculationType,
          customDays: calculationType === 'custom' ? parseFloat(customDaysInput) || 0 : 0
        });

        totalAmount += calc.netSalary;
        items.push({
          payroll_id: newPayroll.id,
          employee_id: emp.id,
          monthly_salary: calc.monthlySalary,
          leave_deduction: calc.leaveDeduction,
          timesheet_deduction: calc.timesheetDeduction,
          pf_deduction: calc.pfDeduction,
          esi_deduction: calc.esiDeduction,
          tax_deduction: calc.taxDeduction,
          loan_deduction: calc.loanDeduction,
          advance_deduction: calc.advanceDeduction, // Auto-fetched from Advance Management
          sunday_work_days: 0,
          bonus: calc.bonus,
          net_salary: calc.netSalary,
          unpaid_leaves: unpaidLeaves,
          missing_timesheets: missingTimesheets,
          holiday_count: holidayCount,
          working_days: calculationType === 'working_days' ? effectiveWorkingDays : calendarDays,
          calculation_type: calculationType,
          calculation_days: calculationType === 'custom' ? parseFloat(customDaysInput) || 0 : (calculationType === 'working_days' ? effectiveWorkingDays : calendarDays),
        });
      }

      const { data: insertedItems, error: insertItemError } = await supabase
        .from('payroll_items')
        .insert(items)
        .select('id, employee_id');

      if (insertItemError || !insertedItems) {
        throw new Error(insertItemError?.message || 'Failed to create payroll items');
      }

      await supabase.from('payrolls').update({ status: 'completed', total_amount: totalAmount }).eq('id', newPayroll.id);

      const payslips = insertedItems.map(item => ({
        payroll_id: newPayroll.id,
        employee_id: item.employee_id,
        payroll_item_id: item.id,
        status: 'generated',
      }));

      const { error: payslipInsertError } = await supabase.from('payslips').insert(payslips);
      if (payslipInsertError) {
        throw new Error(payslipInsertError.message);
      }

      await supabase.from('audit_logs').insert({
        action: 'GENERATE_PAYROLL',
        entity: 'payrolls',
        entity_id: newPayroll.id,
        details: { month: genMonth, year: genYear, employee_count: filteredEmployees.length, total_amount: totalAmount },
      });

      showToast('success', `Payroll for ${getMonthName(genMonth)} ${genYear} generated successfully`);
    } catch (err) {
      showToast('error', 'Failed to generate payroll');
    }

    setGenerating(false);
    setShowGenerateModal(false);
    await loadPayrolls();
  }

  async function markAsPaid(payroll: PayrollType) {
    try {
      // 1. Update payroll status
      await supabase.from('payrolls').update({ status: 'paid', paid_at: new Date().toISOString() }).eq('id', payroll.id);

      // 2. Fetch payroll items to find advance deductions
      const { data: items } = await supabase
        .from('payroll_items')
        .select('employee_id, advance_deduction')
        .eq('payroll_id', payroll.id)
        .gt('advance_deduction', 0);
      
      if (items && items.length > 0) {
        for (const item of items) {
          // Find active advances for this employee (oldest first)
          const { data: activeAdvances } = await supabase
            .from('advances')
            .select('*')
            .eq('employee_id', item.employee_id)
            .eq('status', 'Active')
            .gt('balance', 0)
            .order('created_at', { ascending: true });

          if (activeAdvances && activeAdvances.length > 0) {
            let remainingDeduction = item.advance_deduction;
            for (const adv of activeAdvances) {
              if (remainingDeduction <= 0) break;
              
              const deductionToApply = Math.min(adv.balance, remainingDeduction);
              const newBalance = Math.max(0, adv.balance - deductionToApply);
              const newStatus = newBalance <= 0 ? 'Closed' : 'Active';

              await supabase.from('advances').update({ 
                balance: newBalance,
                status: newStatus 
              }).eq('id', adv.id);

              remainingDeduction -= deductionToApply;
            }
          }
        }
      }

      showToast('success', `Payroll marked as paid and advance balances reduced`);
    } catch (err) {
      console.error('Error marking payroll as paid:', err);
      showToast('error', 'Failed to update advance balances');
    }
    await loadPayrolls();
  }

  async function deletePayroll(payroll: PayrollType) {
    const confirmed = window.confirm(`Delete payroll for ${getMonthName(payroll.month)} ${payroll.year}? This will remove associated payroll items and payslips.`);
    if (!confirmed) return;

    await supabase.from('payslips').delete().eq('payroll_id', payroll.id);
    await supabase.from('payroll_items').delete().eq('payroll_id', payroll.id);
    const { error } = await supabase.from('payrolls').delete().eq('id', payroll.id);

    if (error) {
      showToast('error', 'Failed to delete payroll');
      return;
    }

    if (selectedPayroll?.id === payroll.id) {
      setSelectedPayroll(null);
    }

    showToast('success', 'Payroll deleted');
    await loadPayrolls();
  }

  const statusVariant = (s: string) => {
    if (s === 'paid') return 'success';
    if (s === 'completed') return 'info';
    if (s === 'processing') return 'warning';
    return 'neutral';
  };

  const monthOptions = Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: getMonthName(i + 1) }));
  const yearOptions = [2024, 2025, 2026, 2027].map(y => ({ value: String(y), label: String(y) }));

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-slate-500 dark:text-slate-400 text-sm">Manage monthly payroll runs</p>
        </div>
        <Button icon={<Play size={15} />} onClick={() => setShowGenerateModal(true)}>
          Generate Payroll
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: 'Total Payrolls', value: payrolls.length, icon: <Calculator size={18} className="text-blue-600" />, bg: 'bg-blue-100 dark:bg-blue-900/30' },
          { label: 'Total Disbursed', value: formatCurrency(payrolls.filter(p => p.status === 'paid').reduce((s, p) => s + p.total_amount, 0)), icon: <DollarSign size={18} className="text-emerald-600" />, bg: 'bg-emerald-100 dark:bg-emerald-900/30' },
          { label: 'Pending Payment', value: payrolls.filter(p => p.status !== 'paid').length, icon: <AlertTriangle size={18} className="text-amber-600" />, bg: 'bg-amber-100 dark:bg-amber-900/30' },
        ].map(item => (
          <Card key={item.label}>
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${item.bg}`}>
                {item.icon}
              </div>
              <div>
                <p className="text-xs text-slate-500 dark:text-slate-400">{item.label}</p>
                <p className="font-bold text-slate-800 dark:text-white">{item.value}</p>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Card padding={false}>
        <div className="p-4 border-b border-slate-200 dark:border-slate-700">
          <p className="font-semibold text-slate-800 dark:text-white text-sm">Payroll History</p>
        </div>
        <div className="overflow-x-auto">
          {loading ? (
            <div className="p-5"><TableSkeleton rows={4} cols={5} /></div>
          ) : payrolls.length === 0 ? (
            <div className="py-16 text-center">
              <Calculator size={36} className="mx-auto text-slate-300 dark:text-slate-600 mb-3" />
              <p className="text-slate-500 dark:text-slate-400 text-sm">No payrolls generated yet</p>
              <p className="text-slate-400 dark:text-slate-500 text-xs mt-1">Click "Generate Payroll" to get started</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-700">
                  {['Period', 'Employees', 'Total Amount', 'Status', 'Generated', 'Actions'].map(h => (
                    <th key={h} className={`py-3 px-4 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider text-left ${h === 'Actions' ? 'text-right' : ''}`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {payrolls.map(payroll => (
                  <React.Fragment key={payroll.id}>
                    <tr className="border-b border-slate-50 dark:border-slate-700/30 hover:bg-slate-50/50 dark:hover:bg-slate-700/20 transition-colors">
                      <td className="py-3 px-4">
                        <p className="font-medium text-slate-700 dark:text-slate-200 text-xs">{getMonthName(payroll.month)} {payroll.year}</p>
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-xs text-slate-500 dark:text-slate-400">{payroll.employee_count} employees</span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="font-semibold text-slate-700 dark:text-slate-200 text-xs">{formatCurrency(payroll.total_amount)}</span>
                      </td>
                      <td className="py-3 px-4">
                        <Badge variant={statusVariant(payroll.status)} dot>
                          {payroll.status}
                        </Badge>
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-xs text-slate-400">
                          {payroll.generated_at ? new Date(payroll.generated_at).toLocaleDateString('en-IN') : '—'}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center justify-end gap-2">
                          {payroll.status === 'completed' && (
                            <Button size="sm" variant="secondary" icon={<CheckCircle2 size={12} />} onClick={() => markAsPaid(payroll)}>
                              Mark Paid
                            </Button>
                          )}
                          <button
                            onClick={() => deletePayroll(payroll)}
                            className="p-1.5 text-slate-400 hover:text-red-600 dark:hover:text-red-400 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors"
                            title="Delete payroll"
                          >
                            <Trash2 size={16} />
                          </button>
                          <button
                            onClick={() => loadPayrollAnalysis(payroll)}
                            className="p-1.5 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors"
                            title="View leave and timesheet analysis"
                          >
                            <Eye size={16} />
                          </button>
                          <button
                            onClick={async () => {
                              if (selectedPayroll?.id === payroll.id) {
                                setSelectedPayroll(null);
                              } else {
                                setSelectedPayroll(payroll);
                                await loadPayrollItems(payroll.id);
                              }
                            }}
                            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-900/30 transition-colors"
                            title="Toggle payroll row"
                          >
                            {selectedPayroll?.id === payroll.id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                          </button>
                        </div>
                      </td>
                    </tr>
                    {selectedPayroll?.id === payroll.id && (
                      <tr key={`${payroll.id}-detail`}>
                        <td colSpan={6} className="bg-slate-50 dark:bg-slate-800/50 px-4 py-4">
                          <PayrollBreakdown 
                            items={payrollItems} 
                            loading={loadingItems} 
                            onEdit={(item) => {
                              setEditingItem(item);
                              setAdvanceInput(String(item.advance_deduction || 0));
                              setSundayInput(String(item.sunday_work_days || 0));
                              setBonusInput(String(item.bonus || 0));
                            }} 
                          />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      <Modal
        isOpen={!!analysisPayroll}
        onClose={() => setAnalysisPayroll(null)}
        title={analysisPayroll ? `Payroll analysis for ${getMonthName(analysisPayroll.month)} ${analysisPayroll.year}` : 'Payroll analysis'}
        size="lg"
        footer={
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setAnalysisPayroll(null)}>Close</Button>
          </div>
        }
      >
        {analysisLoading ? (
          <div className="p-5"><TableSkeleton rows={4} cols={7} /></div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-slate-500 dark:text-slate-400">This view shows the LMS leave record and whether the employee submitted their timesheet for the selected payroll month.</p>
            <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-100 dark:bg-slate-700/50 border-b border-slate-200 dark:border-slate-700">
                    {['Employee', 'Leave Taken', 'Leave Source', 'Timesheet Status', 'Missing TS', 'Holidays', 'Advance', 'Sunday Work', 'Net Salary', 'Actions'].map(h => (
                      <th key={h} className="py-2 px-3 text-left font-semibold text-slate-600 dark:text-slate-300 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {analysisItems.map(item => (
                    <tr key={item.id} className="border-b border-slate-100 dark:border-slate-700/30 hover:bg-white dark:hover:bg-slate-700/30">
                      <td className="py-2 px-3 font-medium text-slate-700 dark:text-slate-200">{item.employee?.name}</td>
                      <td className="py-2 px-3 text-slate-600 dark:text-slate-300">{item.unpaid_leaves} day{item.unpaid_leaves === 1 ? '' : 's'}</td>
                      <td className="py-2 px-3 text-slate-500 dark:text-slate-400">{item.leave_source || 'N/A'}</td>
                      <td className="py-2 px-3 text-slate-500 dark:text-slate-400">{item.timesheet_status || 'Unknown'}</td>
                      <td className="py-2 px-3 text-slate-600 dark:text-slate-300">{item.missing_timesheets} day{item.missing_timesheets === 1 ? '' : 's'}</td>
                      <td className="py-2 px-3">
                        <Badge variant="info" dot>{item.holiday_count || 0} holidays</Badge>
                      </td>
                      <td className="py-2 px-3 text-red-500 font-medium">-{formatCurrency(item.advance_deduction || 0)}</td>
                      <td className="py-2 px-3 text-green-500 font-medium">+{item.sunday_work_days || 0} days</td>
                      <td className="py-2 px-3 font-semibold text-slate-800 dark:text-white">{formatCurrency(item.net_salary)}</td>
                      <td className="py-2 px-3">
                        <button
                          onClick={() => {
                            setEditingItem(item);
                            setAdvanceInput(String(item.advance_deduction || 0));
                            setSundayInput(String(item.sunday_work_days || 0));
                            setBonusInput(String(item.bonus || 0));
                          }}
                          className="p-1 text-blue-600 hover:bg-blue-50 rounded"
                          title="Edit manual adjustments"
                        >
                          <Edit2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={showGenerateModal}
        onClose={() => setShowGenerateModal(false)}
        title="Generate Payroll"
        subtitle="Select the month and year for payroll generation"
        size="sm"
        footer={
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setShowGenerateModal(false)}>Cancel</Button>
            <Button loading={generating} icon={<Play size={14} />} onClick={generatePayroll}>
              Generate
            </Button>
          </div>
        }
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Select
            label="Month"
            value={String(genMonth)}
            onChange={e => setGenMonth(Number(e.target.value))}
            options={monthOptions}
          />
          <Select
            label="Year"
            value={String(genYear)}
            onChange={e => setGenYear(Number(e.target.value))}
            options={yearOptions}
          />
          <Select
            label="Employee"
            value={selectedEmployeeId}
            onChange={e => setSelectedEmployeeId(e.target.value)}
            options={[{ value: '', label: 'All Employees' }, ...employees.map(emp => ({ value: emp.id, label: emp.name }))]}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
          <Select
            label="Calculation Type"
            value={calculationType}
            onChange={e => setCalculationType(e.target.value as any)}
            options={[
              { value: 'monthly', label: 'Monthly (Default)' },
              { value: 'custom', label: 'Custom Days' },
              { value: 'working_days', label: 'Working Days (Excl. Sundays)' },
            ]}
          />
          {calculationType === 'custom' && (
            <div>
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Number of Days</label>
              <input
                type="number"
                value={customDaysInput}
                onChange={e => setCustomDaysInput(e.target.value)}
                className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                min="1"
                max="31"
              />
            </div>
          )}
        </div>
        <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
          <p className="text-blue-700 dark:text-blue-300 text-xs">
            Payroll will be calculated based on base salary, leave deductions, timesheet data, PF, ESI, and applicable taxes.
          </p>
        </div>
      </Modal>

      <Modal
        isOpen={!!editingItem}
        onClose={() => setEditingItem(null)}
        title={`Adjust Payroll: ${editingItem?.employee?.name}`}
        size="md"
        footer={
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setEditingItem(null)}>Cancel</Button>
            <Button onClick={updatePayrollItem}>Update Salary</Button>
          </div>
        }
      >
        <div className="space-y-4 py-2">
          <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg mb-4">
            <p className="text-amber-800 dark:text-amber-300 text-xs">
              <strong>Note:</strong> Updating these values will automatically recalculate the employee's Net Salary.
            </p>
          </div>

          <div className="p-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg">
            <label className="block text-sm font-medium text-slate-500 dark:text-slate-400 mb-1">Advance Deduction (₹)</label>
            <div className="flex items-center gap-2">
              <span className="flex-1 px-3 py-2 bg-slate-100 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-md text-sm font-semibold text-slate-700 dark:text-slate-200">
                {formatCurrency(editingItem?.advance_deduction || 0)}
              </span>
              <span className="text-xs text-slate-400 italic">Auto-fetched from Advance Management</span>
            </div>
          </div>
          
          <div className="grid grid-cols-1 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Sunday / OD Work Days</label>
              <input
                type="number"
                value={sundayInput}
                onChange={(e) => setSundayInput(e.target.value)}
                className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="0"
                min="0"
                step="0.5"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Bonus (₹)</label>
              <input
                type="number"
                value={bonusInput}
                onChange={(e) => setBonusInput(e.target.value)}
                className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="0"
                min="0"
              />
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function PayrollBreakdown({ items, loading, onEdit }: { items: PayrollItemWithEmployee[]; loading: boolean; onEdit?: (item: any) => void }) {
  if (loading) return <div className="p-3"><TableSkeleton rows={2} cols={8} /></div>;

  return (
    <div>
      <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">Salary Breakdown</p>
      <div className="mb-4 text-xs text-slate-500 dark:text-slate-400">
        Leave taken and missing or unsubmitted timesheets are deducted from the employee salary in the payroll calculation.
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-100 dark:bg-slate-700/50 border-b border-slate-200 dark:border-slate-700">
              {['Employee', 'Mode', 'Days', 'Monthly Sal.', 'Leave Taken', 'Leave Ded.', 'Missing TS', 'TS Ded.', 'Holidays', 'Advance', 'Sunday', 'PF', 'ESI', 'Tax', 'Bonus', 'Net Salary', ''].map(h => (
                <th key={h} className="py-2 px-3 text-left font-semibold text-slate-600 dark:text-slate-300 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map(item => (
              <tr key={item.id} className="border-b border-slate-50 dark:border-slate-700/30 hover:bg-slate-50/50 dark:hover:bg-slate-700/20 transition-colors">
                <td className="py-2 px-3">
                  <div className="font-medium text-slate-700 dark:text-slate-200">{item.employee?.name}</div>
                  <div className="text-[10px] text-slate-400">CTC: {formatCurrency(item.employee?.ctc || 0)}</div>
                </td>
                <td className="py-2 px-3">
                  <Badge variant={item.calculation_type === 'monthly' ? 'neutral' : 'info'} size="sm" className="capitalize">
                    {item.calculation_type || 'monthly'}
                  </Badge>
                </td>
                <td className="py-2 px-3 text-slate-600 dark:text-slate-300 font-medium">
                  {item.calculation_days || (item.working_days || 26)}d
                </td>
                <td className="py-2 px-3 text-slate-600 dark:text-slate-300">{formatCurrency(item.monthly_salary)}</td>
                <td className="py-2 px-3 text-slate-600 dark:text-slate-300">{item.unpaid_leaves} day{item.unpaid_leaves === 1 ? '' : 's'}</td>
                <td className="py-2 px-3 text-red-500">-{formatCurrency(item.leave_deduction)}</td>
                <td className="py-2 px-3 text-slate-600 dark:text-slate-300">{item.missing_timesheets} day{item.missing_timesheets === 1 ? '' : 's'}</td>
                <td className="py-2 px-3 text-red-500">-{formatCurrency(item.timesheet_deduction)}</td>
                <td className="py-2 px-3">
                  <Badge variant="info" size="sm">{item.holiday_count || 0}h</Badge>
                </td>
                <td className="py-2 px-3 text-red-500">-{formatCurrency(item.advance_deduction || 0)}</td>
                <td className="py-2 px-3 text-green-500">+{item.sunday_work_days || 0}d</td>
                <td className="py-2 px-3 text-red-500">-{formatCurrency(item.pf_deduction)}</td>
                <td className="py-2 px-3 text-red-500">-{formatCurrency(item.esi_deduction)}</td>
                <td className="py-2 px-3 text-red-500">-{formatCurrency(item.tax_deduction)}</td>
                <td className="py-2 px-3 text-emerald-600 dark:text-emerald-400">+{formatCurrency(item.bonus)}</td>
                 <td className="py-2 px-3 font-bold text-slate-800 dark:text-white">{formatCurrency(item.net_salary)}</td>
                 <td className="py-2 px-3">
                   {onEdit && (
                     <button
                       onClick={() => onEdit(item)}
                       className="p-1 text-blue-600 hover:bg-blue-50 rounded"
                       title="Edit adjustments"
                     >
                       <Edit2 size={12} />
                     </button>
                   )}
                 </td>
               </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
