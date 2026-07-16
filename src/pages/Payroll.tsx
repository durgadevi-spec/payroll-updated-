import React, { useState, useEffect, useCallback } from 'react';
import { Calculator, Play, ChevronDown, ChevronUp, CheckCircle2, DollarSign, AlertTriangle, Trash2, Eye, Edit2, FileSpreadsheet, Info, X, RefreshCw, FileText, Maximize2, Minimize2 } from 'lucide-react';
import { PreGenerationAnalysisModal } from '../components/PreGenerationAnalysisModal';
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

const getItemDaysForRate = (item: PayrollItemWithEmployee) => {
  const calculationDays = Number(item.calculation_days || 0);
  const workingDays = Number(item.working_days || 0);
  if (calculationDays > 0) return calculationDays;
  if (workingDays > 0) return workingDays;
  return 30;
};

const safeNumber = (value: any, fallback = 0) => {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
};

const getTimesheetDeduction = (item: PayrollItemWithEmployee) => {
  const missingDays = safeNumber(item.missing_timesheets, 0);
  const storedDeduction = safeNumber(item.timesheet_deduction, 0);

  if (missingDays === 0) {
    return storedDeduction;
  }

  if (storedDeduction > 0) {
    return storedDeduction;
  }

  const days = getItemDaysForRate(item);
  const perDaySalary = days > 0 ? safeNumber(item.monthly_salary, 0) / days : 0;
  return Math.round(perDaySalary * missingDays * 100) / 100;
};

const getMissingPunchDeduction = (item: PayrollItemWithEmployee) => {
  const missingPunches = safeNumber((item as any).missing_punches, 0);
  const storedDeduction = safeNumber((item as any).missing_punch_deduction, 0);

  if (missingPunches === 0) {
    return storedDeduction;
  }

  if (storedDeduction > 0) {
    return storedDeduction;
  }

  const days = getItemDaysForRate(item);
  const perDaySalary = days > 0 ? safeNumber(item.monthly_salary, 0) / days : 0;
  return Math.round(perDaySalary * missingPunches * 100) / 100;
};

const getNetSalary = (item: PayrollItemWithEmployee) => {
  const monthlySalary = safeNumber(item.monthly_salary, 0);
  const leaveDeduction = safeNumber(item.leave_deduction, 0);
  const tsDeduction = getTimesheetDeduction(item);
  const mpDeduction = getMissingPunchDeduction(item);
  const pfDeduction = safeNumber(item.pf_deduction, 0);
  const esiDeduction = safeNumber(item.esi_deduction, 0);
  const taxDeduction = safeNumber(item.tax_deduction, 0);
  const loanDeduction = safeNumber(item.loan_deduction, 0);
  const advanceDeduction = safeNumber(item.advance_deduction, 0);
  const permissionDeduction = safeNumber((item as any).permission_deduction, 0);
  const sandwichDeduction = safeNumber((item as any).sandwich_deduction_amount, 0);
  const hourlyDeduction = safeNumber((item as any).hourly_deduction, 0);
  const bonus = safeNumber(item.bonus, 0);
  const sundayEarnings = (monthlySalary / getItemDaysForRate(item)) * safeNumber(item.sunday_work_days, 0);

  return Math.max(0, Math.round((monthlySalary - leaveDeduction - tsDeduction - mpDeduction - pfDeduction - esiDeduction - taxDeduction - loanDeduction - advanceDeduction - permissionDeduction - sandwichDeduction - hourlyDeduction + bonus + sundayEarnings) * 100) / 100);
};

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
  const [missingDatesModal, setMissingDatesModal] = useState<{ name: string; dates: string[] } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [showPreGenModal, setShowPreGenModal] = useState(false);
  const [showPastAnalysisModal, setShowPastAnalysisModal] = useState(false);
  const [pastAnalysisPayroll, setPastAnalysisPayroll] = useState<PayrollType | null>(null);
  const [pastAnalysisEmpIds, setPastAnalysisEmpIds] = useState<string[]>([]);
  const [previewData, setPreviewData] = useState<any>(null);
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
      const data = (await response.json()) as PayrollItemWithEmployee[];
      setPayrollItems(data || []);

      // Recalculate the correct total from the live net_salary values (which apply LMS, PL/SL, permission logic)
      const correctTotal = (data || []).reduce((sum, item) => sum + safeNumber(item.net_salary, 0), 0);
      // Update UI immediately so the Payroll History row shows the right Total Amount
      setPayrolls(prev => prev.map(p => p.id === payrollId ? { ...p, total_amount: correctTotal } : p));
      // Persist to DB so the value is correct on next page load too
      await supabase.from('payrolls').update({ total_amount: correctTotal }).eq('id', payrollId);
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

  async function handleRefreshPayroll() {
    if (!analysisPayroll) return;
    setRefreshing(true);
    try {
      // 1. Fetch updated external data by calling the analysis route (which calculates everything live)
      const res = await fetch(`/api/payroll-items/analysis/${analysisPayroll.id}`);
      if (!res.ok) throw new Error('Failed to fetch updated analysis');
      const latestData: any[] = await res.json();

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
        const deduction = (adv.repayment_type === 'One-time' || inst === 0) ? bal : Math.min(inst, bal);
        if (deduction > 0) {
          advanceByEmp.set(adv.employee_id, (advanceByEmp.get(adv.employee_id) || 0) + deduction);
        }
      });

      // 2. Loop through all items and update them with the recalculated attendance/leave data
      await Promise.all(latestData.map(async (item) => {
        // Calculate leave deduction locally for patch since item.leave_deduction in analysis is the old stored one
        const monthlySalary = Number(item.monthly_salary) || 0;
        const calendarDays = new Date(Number(analysisPayroll.year), Number(analysisPayroll.month), 0).getDate();
        const rate = monthlySalary / (item.working_days || calendarDays);

        const recalculatedLeaveDed = Math.round(rate * Number(item.unpaid_leaves) * 100) / 100;

        const patchPayload = {
          unpaid_leaves: item.unpaid_leaves,
          leave_deduction: recalculatedLeaveDed,
          missing_timesheets: item.missing_timesheets,
          timesheet_deduction: item.timesheet_deduction,
          missing_punches: item.missing_punches || 0,
          missing_punch_deduction: item.missing_punch_deduction || 0,
          timesheet_excluded_dates: item.timesheet_excluded_dates,
          holiday_dates: item.holiday_dates,
          advance_deduction: advanceByEmp.get(item.employee_id) || 0,
          permission_hours: item.permission_hours,
          permission_deduction: item.permission_deduction,
        };

        await fetch(`/api/payroll-items/${item.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patchPayload)
        });
      }));

      showToast('success', 'Payroll external data refreshed successfully');
      await loadPayrolls();
      await loadPayrollAnalysis(analysisPayroll);
    } catch (error) {
      console.error(error);
      showToast('error', 'Failed to refresh payroll data');
    }
    setRefreshing(false);
  }

  async function generatePayroll(dataOverride?: any) {
    const dataToUse = dataOverride || previewData;
    if (!dataToUse) return;

    setGenerating(true);
    try {
      const { data: settingsData } = await supabase.from('settings').select('*');
      const settings = Object.fromEntries((settingsData || []).map(s => [s.key, s.value || '']));
      const pfRate = parseFloat(settings.pf_rate || '12');
      const esiRate = parseFloat(settings.esi_rate || '0.75');
      const esiLimit = parseFloat(settings.esi_limit || '21000');
      const taxRate = parseFloat(settings.tax_rate || '10');
      const workingDays = parseInt(settings.working_days || '26');

      const { data: advancesData } = await supabase
        .from('advances')
        .select('employee_id, installment_amount, balance, status, repayment_type')
        .eq('status', 'Active')
        .gt('balance', 0);

      const advanceByEmp = new Map<string, number>();
      (advancesData || []).forEach((adv: any) => {
        const inst = parseFloat(adv.installment_amount || 0);
        const bal = parseFloat(adv.balance || 0);
        const deduction = (adv.repayment_type === 'One-time' || inst === 0) ? bal : Math.min(inst, bal);
        if (deduction > 0) {
          advanceByEmp.set(adv.employee_id, (advanceByEmp.get(adv.employee_id) || 0) + deduction);
        }
      });

      const calendarDays = new Date(genYear, genMonth, 0).getDate();

      let totalAmount = 0;
      const items = [];

      // We already created the payroll row first so we can attach items to it
      const { data: newPayroll } = await supabase
        .from('payrolls')
        .insert({
          month: genMonth,
          year: genYear,
          status: 'completed',
          employee_count: dataToUse.employees.length,
          total_amount: 0,
          generated_at: new Date().toISOString()
        })
        .select()
        .single();

      if (!newPayroll) throw new Error('Failed to create payroll');

      for (const emp of dataToUse.employees) {
        const monthlySalary = emp.ctc / 12;
        let effectiveWorkingDays = workingDays;
        if (calculationType === 'working_days') {
          const totalDays = new Date(genYear, genMonth, 0).getDate();
          const sundays = countSundays(genMonth, genYear);
          effectiveWorkingDays = totalDays - sundays;
        }

        const advanceDeduction = advanceByEmp.get(emp.id) || 0;

        const totalUnpaid = emp.summary.unpaidDays || 0;
        const punchMissing = emp.summary.punchMissing || 0;
        const sundayDeductions = emp.summary.sundayDeductions || 0;
        const lessThan9 = emp.summary.lessThan9 || 0;

        const nonLeaveDeductions = punchMissing + sundayDeductions + lessThan9;
        const unpaidLeaves = Math.max(0, totalUnpaid - nonLeaveDeductions);

        const missingTimesheets = 0;

        // Pass lessThan9 as missingPunches so they are bucketed correctly in DB
        const effectiveMissingPunches = punchMissing + lessThan9;

        // Daily biometric hours short of 9h/day, net of approved LMS permission / monthly 3h allowance.
        // Deducted proportionally by the hour (not as a full missing day).
        const hourlyDeductionAmount = emp.summary.hourlyDeductionAmount || 0;

        const calc = calculatePayroll({
          monthlySalary,
          workingDays: effectiveWorkingDays,
          calendarDays,
          unpaidLeaves,
          missingTimesheets,
          missingPunches: effectiveMissingPunches,
          bonus: 0,
          pfRate,
          esiRate,
          esiLimit,
          taxRate,
          loanDeduction: 0,
          advanceDeduction,
          sundayWorkDays: 0,
          calculationType,
          customDays: calculationType === 'custom' ? parseFloat(customDaysInput) || 0 : 0,
          sundayDeductions,
          hourlyDeductionAmount
        });

        totalAmount += calc.netSalary;
        items.push({
          payroll_id: newPayroll.id,
          employee_id: emp.id,
          monthly_salary: calc.monthlySalary,
          leave_deduction: calc.leaveDeduction,
          timesheet_deduction: calc.timesheetDeduction,
          missing_punches: effectiveMissingPunches,
          missing_punch_deduction: calc.missingPunchDeduction,
          pf_deduction: calc.pfDeduction,
          esi_deduction: calc.esiDeduction,
          tax_deduction: calc.taxDeduction,
          loan_deduction: calc.loanDeduction,
          advance_deduction: calc.advanceDeduction,
          sunday_work_days: 0,
          bonus: calc.bonus,
          net_salary: calc.netSalary,
          unpaid_leaves: unpaidLeaves,
          missing_timesheets: missingTimesheets,
          holiday_count: 0,
          pa_sla_consumed: 0,
          timesheet_excluded_dates: [],
          holiday_dates: [],
          working_days: calculationType === 'working_days' ? effectiveWorkingDays : calendarDays,
          calculation_type: calculationType,
          calculation_days: calculationType === 'custom' ? parseFloat(customDaysInput) || 0 : (calculationType === 'working_days' ? effectiveWorkingDays : calendarDays),
          permission_hours: 0,
          permission_deduction: calc.permissionDeduction,
          hourly_short_hours: emp.summary.deductibleShortfallHours || 0,
          hourly_deduction: calc.hourlyDeductionAmount,
        });
      }

      const { data: insertedItems, error: insertItemError } = await supabase
        .from('payroll_items')
        .insert(items)
        .select('id, employee_id');

      if (insertItemError || !insertedItems) {
        throw new Error(insertItemError?.message || 'Failed to create payroll items');
      }

      await supabase.from('payrolls').update({ total_amount: totalAmount }).eq('id', newPayroll.id);

      const payslips = insertedItems.map(item => ({
        payroll_id: newPayroll.id,
        employee_id: item.employee_id,
        payroll_item_id: item.id,
        status: 'generated',
      }));

      await supabase.from('payslips').insert(payslips);

      await supabase.from('audit_logs').insert({
        action: 'GENERATE_PAYROLL',
        entity: 'payrolls',
        entity_id: newPayroll.id,
        details: { month: genMonth, year: genYear, employee_count: dataToUse.employees.length, total_amount: totalAmount },
      });

      showToast('success', `Payroll for ${getMonthName(genMonth)} ${genYear} generated successfully`);
    } catch (err) {
      console.error(err);
      showToast('error', 'Failed to generate payroll');
    }

    setGenerating(false);
    setShowPreGenModal(false);
    setShowConfigModal(false);
    await loadPayrolls();
  }

  async function markAsPaid(payroll: PayrollType) {
    try {
      await supabase.from('payrolls').update({ status: 'paid', paid_at: new Date().toISOString() }).eq('id', payroll.id);
      const { data: items } = await supabase
        .from('payroll_items')
        .select('employee_id, advance_deduction, pa_sla_consumed')
        .eq('payroll_id', payroll.id);

      if (items && items.length > 0) {
        for (const item of items) {
          if (item.advance_deduction && item.advance_deduction > 0) {
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
                await supabase.from('advances').update({ balance: newBalance, status: newStatus }).eq('id', adv.id);
                remainingDeduction -= deductionToApply;
              }
            }
          }
          if (item.pa_sla_consumed && item.pa_sla_consumed > 0) {
            const { data: empData } = await supabase
              .from('employees')
              .select('pa_sla_balance')
              .eq('id', item.employee_id)
              .single();
            if (empData) {
              const currentBalance = Number(empData.pa_sla_balance) || 0;
              const newBalance = Math.max(0, currentBalance - item.pa_sla_consumed);
              await supabase.from('employees').update({ pa_sla_balance: newBalance }).eq('id', item.employee_id);
            }
          }
        }
      }
      showToast('success', `Payroll marked as paid, advance & leave balances updated`);
    } catch (err) {
      console.error('Error marking payroll as paid:', err);
      showToast('error', 'Failed to update advance balances');
    }
    await loadPayrolls();
  }

  async function deletePayroll(payroll: PayrollType) {
    const confirmed = window.confirm(`Delete payroll for ${getMonthName(payroll.month)} ${payroll.year}? This will remove associated payroll items and payslips.`);
    if (!confirmed) return;

    if (payroll.status === 'paid') {
      const { data: items } = await supabase
        .from('payroll_items')
        .select('employee_id, pa_sla_consumed')
        .eq('payroll_id', payroll.id)
        .gt('pa_sla_consumed', 0);

      if (items && items.length > 0) {
        for (const item of items) {
          const { data: empData } = await supabase
            .from('employees')
            .select('pa_sla_balance')
            .eq('id', item.employee_id)
            .single();
          if (empData) {
            const currentBalance = Number(empData.pa_sla_balance) || 0;
            const newBalance = currentBalance + item.pa_sla_consumed;
            await supabase.from('employees').update({ pa_sla_balance: newBalance }).eq('id', item.employee_id);
          }
        }
      }
    }

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

  async function downloadPayrollExcel(payroll: PayrollType) {
    try {
      const response = await fetch(`/api/payroll-items/analysis/${payroll.id}`);
      if (!response.ok) throw new Error('Failed to fetch payroll items');
      const items = await response.json();

      const headers = [
        'Employee Name',
        'Employee Code',
        'CTC',
        'Monthly Salary',
        'Leave Taken (days)',
        'Leave Deduction',
        'Missing Timesheets (days)',
        'Timesheet Deduction',
        'Missing Punches (days)',
        'Missing Punch Deduction',
        'Sandwich Days',
        'Sandwich Deduction',
        'Permission Hours',
        'Permission Deduction',
        'Hourly Short Hours',
        'Hourly Deduction',
        'Holidays',
        'Advance Deduction',
        'Sunday/OD Work (days)',
        'PF Deduction',
        'ESI Deduction',
        'Tax Deduction',
        'Bonus',
        'Net Salary'
      ];

      const escapeCell = (v: any) => {
        if (v === null || v === undefined) return '';
        const s = String(v);
        if (s.includes(',') || s.includes('"') || s.includes('\n')) {
          return '"' + s.replace(/"/g, '""') + '"';
        }
        return s;
      };

      const rows = items.map((item: any) => [
        item.employee?.name || '',
        item.employee?.employee_code || '',
        (item.employee?.ctc || 0),
        (item.monthly_salary || 0),
        (item.unpaid_leaves || 0),
        (item.leave_deduction || 0),
        (item.missing_timesheets || 0),
        (item.timesheet_deduction || 0),
        (item.missing_punches || 0),
        (item.missing_punch_deduction || 0),
        (item.sandwich_deducted_days || 0),
        (item.sandwich_deduction_amount || 0),
        (item.permission_hours || 0),
        (item.permission_deduction || 0),
        (item.hourly_short_hours || 0),
        (item.hourly_deduction || 0),
        (item.holiday_count || 0),
        (item.advance_deduction || 0),
        (item.sunday_work_days || 0),
        (item.pf_deduction || 0),
        (item.esi_deduction || 0),
        (item.tax_deduction || 0),
        (item.bonus || 0),
        (item.net_salary || 0)
      ] as any[]);

      const csvLines = [headers.map(escapeCell).join(',')];
      for (const r of rows) {
        csvLines.push(r.map(escapeCell).join(','));
      }

      const csv = csvLines.join('\r\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Payroll_${getMonthName(payroll.month)}_${payroll.year}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export failed', err);
      showToast('error', 'Failed to download payroll');
    }
  }

  async function openPastAnalysis(payroll: PayrollType) {
    try {
      const response = await fetch(`/api/payroll-items/analysis/${payroll.id}`);
      if (!response.ok) throw new Error('Failed to fetch payroll items');
      const items = await response.json();
      const empIds = items.map((i: any) => i.employee?.id).filter(Boolean);

      setPastAnalysisPayroll(payroll);
      setPastAnalysisEmpIds(empIds);
      setShowPastAnalysisModal(true);
    } catch (err) {
      console.error(err);
      showToast('error', 'Failed to load analysis data');
    }
  }

  const getRowClass = (status: string) => {
    if (status === 'completed') return 'success';
    if (status === 'processing') return 'warning';
    if (status === 'paid') return 'info';
    return 'neutral';
  };

  const monthOptions = Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: getMonthName(i + 1) }));
  const yearOptions = [2024, 2025, 2026, 2027].map(y => ({ value: String(y), label: String(y) }));

  const statusVariant = (s: string) => {
    if (s === 'paid') return 'success';
    if (s === 'completed') return 'info';
    if (s === 'processing') return 'warning';
    return 'neutral';
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-slate-500 dark:text-slate-400 text-sm">Manage monthly payroll runs</p>
        </div>
        <Button icon={<Play size={16} />} onClick={() => setShowConfigModal(true)}>
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
                            onClick={() => openPastAnalysis(payroll)}
                            className="p-1.5 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-colors"
                            title="View Analysis"
                          >
                            <span className="text-sm">📊</span>
                          </button>
                          <button
                            onClick={() => downloadPayrollExcel(payroll)}
                            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-900/30 transition-colors"
                            title="Download Excel"
                          >
                            <FileSpreadsheet size={16} />
                          </button>
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
          <div className="flex justify-between items-center w-full">
            <Button variant="outline" onClick={handleRefreshPayroll} disabled={refreshing} className="gap-2 text-indigo-600 border-indigo-200 hover:bg-indigo-50">
              <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
              {refreshing ? 'Refreshing...' : 'Refresh External Data'}
            </Button>
            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setAnalysisPayroll(null)}>Close</Button>
            </div>
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
                    {['Employee', 'Leave Taken', 'Leave Source', 'Timesheet Status', 'Missing TS', 'TS Detection', 'Missing Punch', 'Punch Ded.', 'Sandwich', 'Sandwich Ded.', 'Permissions', 'Perm. Ded.', 'Hourly Short', 'Hourly Ded.', 'Holidays', 'Advance', 'Sunday Work', 'Net Salary', 'Actions'].map(h => (
                      <th key={h} className="py-2 px-3 text-left font-semibold text-slate-600 dark:text-slate-300 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...analysisItems].sort((a, b) => (a.employee?.name || '').localeCompare(b.employee?.name || '', undefined, { sensitivity: 'base' })).map(item => (
                    <tr key={item.id} className="border-b border-slate-100 dark:border-slate-700/30 hover:bg-white dark:hover:bg-slate-700/30">
                      <td className="py-2 px-3 font-medium text-slate-700 dark:text-slate-200">{item.employee?.name}</td>
                      <td className="py-2 px-3 text-slate-600 dark:text-slate-300">{item.unpaid_leaves} day{item.unpaid_leaves === 1 ? '' : 's'}</td>
                      <td className="py-2 px-3 text-slate-500 dark:text-slate-400">{item.leave_source || 'N/A'}</td>
                      <td className="py-2 px-3 text-slate-500 dark:text-slate-400">{item.timesheet_status || 'Unknown'}</td>
                      <td className="py-2 px-3 text-slate-600 dark:text-slate-300">
                        <button
                          onClick={() => setMissingDatesModal({ name: item.employee?.name || 'Employee', dates: (item as any).missing_dates || [] })}
                          className="text-left underline text-slate-600 dark:text-slate-300"
                          title="View missing timesheet dates"
                        >
                          {item.missing_timesheets} day{item.missing_timesheets === 1 ? '' : 's'}
                        </button>
                      </td>
                      <td className="py-2 px-3 text-red-500 font-medium">-{formatCurrency(getTimesheetDeduction(item))}</td>
                      <td className="py-2 px-3">
                        <button
                          onClick={() => setMissingDatesModal({ name: item.employee?.name || 'Employee', dates: (item as any).missing_punch_dates || [] })}
                          className={`text-left underline ${(item as any).missing_punches > 0 ? 'text-orange-600 dark:text-orange-400 font-semibold' : 'text-slate-600 dark:text-slate-300'}`}
                          title="View missing punch dates"
                        >
                          {((item as any).missing_punches || 0) + ((item as any).covered_by_leave_dates || []).length} day{(((item as any).missing_punches || 0) + ((item as any).covered_by_leave_dates || []).length) === 1 ? '' : 's'}
                        </button>
                        {(() => {
                          const coveredDates = (item as any).covered_by_leave_dates || [];
                          if (coveredDates.length === 0) return null;
                          const odDates = (item as any).od_dates || [];
                          const odCovered = coveredDates.filter((d: string) => odDates.includes(d)).length;
                          const normalCovered = coveredDates.length - odCovered;
                          return (
                            <div className="text-[10px] text-green-600 dark:text-green-400 mt-0.5 whitespace-nowrap">
                              {odCovered > 0 && <div>{odCovered} approved OD no deduction ✓</div>}
                              {normalCovered > 0 && <div>{normalCovered} covered by leave ✓</div>}
                            </div>
                          );
                        })()}
                      </td>
                      <td className="py-2 px-3 text-red-500 font-medium">-{formatCurrency(getMissingPunchDeduction(item))}</td>
                      <td className="py-2 px-3 font-medium text-slate-700 dark:text-slate-300">
                        {(item as any).sandwich_deducted_days || 0} day{(item as any).sandwich_deducted_days === 1 ? '' : 's'}
                      </td>
                      <td className="py-2 px-3 text-red-500 font-medium">-{formatCurrency((item as any).sandwich_deduction_amount || 0)}</td>
                      <td className="py-2 px-3 font-medium text-slate-700 dark:text-slate-300">{(item as any).permission_hours || 0}h</td>
                      <td className="py-2 px-3 text-red-500 font-medium">-{formatCurrency((item as any).permission_deduction || 0)}</td>
                      <td className="py-2 px-3 font-medium text-slate-700 dark:text-slate-300">{(item as any).hourly_short_hours || 0}h</td>
                      <td className="py-2 px-3 text-red-500 font-medium">-{formatCurrency((item as any).hourly_deduction || 0)}</td>
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
        isOpen={!!missingDatesModal}
        onClose={() => setMissingDatesModal(null)}
        title={missingDatesModal ? `${missingDatesModal.name} — Missing Timesheet Dates` : 'Missing Dates'}
        size="sm"
        footer={
          <div className="flex justify-end">
            <Button variant="outline" onClick={() => setMissingDatesModal(null)}>Close</Button>
          </div>
        }
      >
        <div className="py-2">
          {missingDatesModal && missingDatesModal.dates.length > 0 ? (
            <ul className="list-disc list-inside text-sm">
              {missingDatesModal.dates.map(d => (
                <li key={d} className="py-1">{new Date(d).toLocaleDateString('en-IN')}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">No missing dates recorded.</p>
          )}
        </div>
      </Modal>

      <Modal
        isOpen={showConfigModal}
        onClose={() => setShowConfigModal(false)}
        title="Configure Payroll Generation"
        subtitle="Select the month and year for payroll generation"
        size="sm"
        footer={
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setShowConfigModal(false)}>Cancel</Button>
            <Button icon={<Play size={14} />} onClick={() => {
              setShowConfigModal(false);
              setShowPreGenModal(true);
            }}>
              Preview & Validate
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

      <PreGenerationAnalysisModal
        isOpen={showPreGenModal}
        onClose={() => setShowPreGenModal(false)}
        onConfirm={generatePayroll}
        month={genMonth}
        year={genYear}
        employeeIds={selectedEmployeeId ? [selectedEmployeeId] : employees.map(e => e.id)}
      />

      {pastAnalysisPayroll && (
        <PreGenerationAnalysisModal
          isOpen={showPastAnalysisModal}
          onClose={() => setShowPastAnalysisModal(false)}
          onConfirm={() => { }}
          month={pastAnalysisPayroll.month}
          year={pastAnalysisPayroll.year}
          employeeIds={pastAnalysisEmpIds}
          viewOnly={true}
        />
      )}

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
  const [showDetails, setShowDetails] = useState(false);
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [salarySlipModal, setSalarySlipModal] = useState<PayrollItemWithEmployee | null>(null);
  const [missingPunchDetailsModal, setMissingPunchDetailsModal] = useState<PayrollItemWithEmployee | null>(null);

  if (loading) return <div className="p-3"><TableSkeleton rows={2} cols={8} /></div>;

  const fmt = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });

  // Alphabetical by employee name — keep this as the single source of row order.
  const sortedItems = [...items].sort((a, b) =>
    (a.employee?.name || '').localeCompare(b.employee?.name || '', undefined, { sensitivity: 'base' })
  );

  return (
    <div className={isFullScreen ? "fixed inset-0 z-50 bg-white dark:bg-slate-900 p-4 sm:p-6 flex flex-col min-w-0 min-h-0" : "min-w-0"}>
      <div className="flex items-center justify-between mb-3 flex-shrink-0">
        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Salary Breakdown</p>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsFullScreen(v => !v)}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border font-medium bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
          >
            {isFullScreen ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
            {isFullScreen ? 'Exit Full Screen' : 'Full Screen'}
          </button>
          <button
            onClick={() => setShowDetails(v => !v)}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors ${showDetails
              ? 'bg-indigo-600 text-white border-indigo-600'
              : 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 border-indigo-300 dark:border-indigo-700 hover:bg-indigo-50 dark:hover:bg-indigo-900/30'
              }`}
          >
            <Info size={12} />
            {showDetails ? 'Hide Date Details' : 'Show Excluded Dates'}
          </button>
        </div>
      </div>
      <div className="mb-3 text-xs text-slate-500 dark:text-slate-400 flex-shrink-0">
        Leave taken and missing or unsubmitted timesheets are deducted from the employee salary in the payroll calculation.
      </div>
      {/* Scroll area is intentionally bounded (max-h in normal mode, flex-1 in full screen) and
          given min-w-0/max-w-full so the wide table's overflow is captured HERE via overflow-auto
          instead of leaking out and making the whole page scroll — that leak is what was breaking
          the sticky header (it was sticking relative to the page, not this box) and causing the
          "floating" header artifact. border-separate (instead of border-collapse) is used because
          sticky cells combined with collapsed borders render incorrectly in Chromium/WebKit. */}
      <div className={`w-full max-w-full min-w-0 rounded-lg border border-slate-300 dark:border-slate-700 overflow-auto overscroll-contain shadow-sm ${isFullScreen ? 'flex-1 min-h-0' : 'max-h-[65vh]'}`}>
        <table className="w-full text-xs border-separate border-spacing-0">
          <thead>
            <tr>
              {['Employee', 'Mode', 'Days', 'Monthly Sal.', 'Leave Taken', 'Leave Ded.', 'Missing TS', 'TS Ded.', 'Missing Punch', 'Punch Ded.', 'Sandwich', 'Sandwich Ded.', 'Permissions', 'Perm. Ded.', 'Hourly Short', 'Hourly Ded.', 'Holidays', 'Advance', 'Sunday', 'PF', 'ESI', 'Tax', 'Bonus', 'Net Salary', ''].map((h, i) => (
                <th
                  key={h}
                  className={`py-2.5 px-3 text-left font-semibold text-[10.5px] uppercase tracking-wide text-slate-500 dark:text-slate-300 whitespace-nowrap bg-slate-100 dark:bg-slate-800 border-b-2 border-slate-300 dark:border-slate-600 border-r border-slate-200 dark:border-slate-700 sticky top-0 ${i === 0 ? 'left-0 z-20 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.15)]' : 'z-10'
                    }`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedItems.map((item, idx) => {
              const excluded: string[] = (item as any).timesheet_excluded_dates || [];
              const holidayDates: string[] = (item as any).holiday_dates || [];
              const leaveDates: string[] = (item as any).leave_dates || [];
              const odDates: string[] = (item as any).od_dates || [];
              const uncoveredCompOffDates: string[] = (item as any).uncovered_comp_off_dates || [];
              const finalMissingDates: string[] = (item as any).missing_dates || [];
              const isOD = (item as any).leave_type === 'OD' || (odDates.length > 0 && item.unpaid_leaves === 0 && uncoveredCompOffDates.length === 0);
              const isExpanded = expandedItemId === item.id;

              // Solid (non-transparent) row backgrounds — required for the frozen first column.
              // A translucent bg (e.g. slate-50/60) lets the columns scrolled underneath show
              // through the "sticky" column, which is what caused the garbled/overlapping text.
              const rowBg = idx % 2 === 1 ? 'bg-slate-50 dark:bg-slate-800' : 'bg-white dark:bg-slate-900';
              const rowHoverBg = idx % 2 === 1 ? 'hover:bg-indigo-50 dark:hover:bg-indigo-900/40' : 'hover:bg-indigo-50 dark:hover:bg-indigo-900/30';

              return (
                <React.Fragment key={item.id}>
                  <tr className={`group border-b border-slate-200 dark:border-slate-700/40 transition-colors ${rowBg} ${rowHoverBg}`}>
                    <td className={`py-2 px-3 sticky left-0 z-10 border-r border-b border-slate-200 dark:border-slate-800 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)] ${rowBg} ${rowHoverBg}`}>
                      <div className="flex items-center gap-2">
                        <div>
                          <div className="font-medium text-slate-700 dark:text-slate-200">{item.employee?.name}</div>
                          <div className="text-[10px] text-slate-400">CTC: {formatCurrency(item.employee?.ctc || 0)}</div>
                        </div>
                        <button onClick={() => setSalarySlipModal(item)} className="ml-auto p-1 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 rounded transition-colors" title="View Full Salary Details">
                          <FileText size={14} />
                        </button>
                      </div>
                    </td>
                    <td className="py-2 px-3 border-r border-b border-slate-100 dark:border-slate-800">
                      <Badge variant={item.calculation_type === 'monthly' ? 'neutral' : 'info'} size="sm" className="capitalize">
                        {item.calculation_type || 'monthly'}
                      </Badge>
                    </td>
                    <td className="py-2 px-3 text-slate-600 dark:text-slate-300 font-medium border-r border-b border-slate-100 dark:border-slate-800">
                      {item.calculation_days || (item.working_days || 26)}d
                    </td>
                    <td className="py-2 px-3 text-slate-600 dark:text-slate-300 border-r border-b border-slate-100 dark:border-slate-800">{formatCurrency(item.monthly_salary)}</td>
                    <td className="py-2 px-3 border-r border-b border-slate-100 dark:border-slate-800">
                      <div>{item.unpaid_leaves} day{item.unpaid_leaves === 1 ? '' : 's'}</div>
                      {odDates.length > 0 && (
                        <div className="text-[10px] text-purple-600 dark:text-purple-400 font-medium mt-0.5">
                          +{odDates.length}d OD (no deduction)
                        </div>
                      )}
                      {uncoveredCompOffDates.length > 0 && (
                        <div className="text-[10px] text-amber-600 dark:text-amber-500 font-medium mt-0.5 leading-tight">
                          ({uncoveredCompOffDates.length}d unpaid: no comp-off bal)
                        </div>
                      )}
                    </td>
                    <td className="py-2 px-3 border-r border-b border-slate-100 dark:border-slate-800">
                      {isOD
                        ? <span className="text-purple-600 dark:text-purple-400 font-medium">₹0 (OD)</span>
                        : <span className="text-red-500">-{formatCurrency(item.leave_deduction)}</span>
                      }
                    </td>
                    <td className="py-2 px-3 border-r border-b border-slate-100 dark:border-slate-800">
                      <div className="flex items-center gap-1">
                        <span className="text-slate-600 dark:text-slate-300">{item.missing_timesheets} day{item.missing_timesheets === 1 ? '' : 's'}</span>
                        {showDetails && (
                          <button
                            onClick={() => setExpandedItemId(isExpanded ? null : item.id)}
                            className={`transition-colors ${excluded.length > 0 ? 'text-amber-500 hover:text-amber-700' : 'text-slate-400 hover:text-slate-600'}`}
                            title={excluded.length > 0 ? `${excluded.length} date(s) excluded from TS deduction` : 'View date breakdown'}
                          >
                            <Info size={11} />
                          </button>
                        )}
                      </div>
                      {showDetails && excluded.length > 0 && (
                        <div className="text-[10px] text-amber-600 dark:text-amber-400 mt-0.5">
                          {excluded.length} excluded ✓
                        </div>
                      )}
                    </td>
                    <td className="py-2 px-3 border-r border-b border-slate-100 dark:border-slate-800 text-red-500">-{formatCurrency(getTimesheetDeduction(item))}</td>
                    <td className="py-2 px-3 border-r border-b border-slate-100 dark:border-slate-800">
                      <div className="flex flex-col">
                        <div className="flex items-center gap-1.5">
                          <span className={(item as any).missing_punches > 0 ? 'text-orange-600 dark:text-orange-400 font-semibold' : 'text-slate-600 dark:text-slate-300'}>
                            {((item as any).missing_punches || 0) + ((item as any).covered_by_leave_dates || []).length} day{(((item as any).missing_punches || 0) + ((item as any).covered_by_leave_dates || []).length) === 1 ? '' : 's'}
                          </span>
                          {(((item as any).missing_punches || 0) + ((item as any).covered_by_leave_dates || []).length > 0) && (
                            <button onClick={() => setMissingPunchDetailsModal(item)} className="p-0.5 text-slate-400 hover:text-indigo-600 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors" title="View breakdown">
                              <Info size={13} />
                            </button>
                          )}
                        </div>
                        {(() => {
                          const incompleteDates = (item as any).incomplete_punch_dates || [];
                          const coveredDates = (item as any).covered_by_leave_dates || [];
                          const odDates = (item as any).od_dates || [];
                          const halfDayDates = (item as any).half_day_leave_dates || [];
                          const odCovered = coveredDates.filter((d: string) => odDates.includes(d)).length;
                          const normalCovered = coveredDates.length - odCovered;

                          if (coveredDates.length === 0 && incompleteDates.length === 0 && halfDayDates.length === 0) return null;

                          return (
                            <div className="text-[9px] mt-0.5 whitespace-nowrap">
                              {incompleteDates.length > 0 && <div className="text-amber-600 dark:text-amber-400 font-semibold mb-0.5">⚠️ {incompleteDates.length} incomplete</div>}
                              {odCovered > 0 && <div className="text-green-600 dark:text-green-400">{odCovered} approved OD no deduction</div>}
                              {normalCovered > 0 && <div className="text-green-600 dark:text-green-400">{normalCovered} covered by leave</div>}
                            </div>
                          );
                        })()}
                      </div>
                    </td>
                    <td className="py-2 px-3 border-r border-b border-slate-100 dark:border-slate-800 text-red-500">-{formatCurrency(getMissingPunchDeduction(item))}</td>
                    <td className="py-2 px-3 border-r border-b border-slate-100 dark:border-slate-800">
                      <div className="flex flex-col">
                        <span className={(item as any).sandwich_deducted_days > 0 ? 'text-orange-600 dark:text-orange-400 font-semibold' : 'text-slate-600 dark:text-slate-300'}>
                          {(item as any).sandwich_deducted_days || 0} day{(item as any).sandwich_deducted_days === 1 ? '' : 's'}
                        </span>
                      </div>
                    </td>
                    <td className="py-2 px-3 border-r border-b border-slate-100 dark:border-slate-800 text-red-500">-{formatCurrency((item as any).sandwich_deduction_amount || 0)}</td>
                    <td className="py-2 px-3 border-r border-b border-slate-100 dark:border-slate-800 font-medium text-slate-700 dark:text-slate-300">{item.permission_hours || 0}h</td>
                    <td className="py-2 px-3 border-r border-b border-slate-100 dark:border-slate-800 text-red-500">-{formatCurrency(item.permission_deduction || 0)}</td>
                    <td className="py-2 px-3 border-r border-b border-slate-100 dark:border-slate-800 font-medium text-slate-700 dark:text-slate-300">{(item as any).hourly_short_hours || 0}h</td>
                    <td className="py-2 px-3 border-r border-b border-slate-100 dark:border-slate-800 text-red-500">-{formatCurrency((item as any).hourly_deduction || 0)}</td>
                    <td className="py-2 px-3 border-r border-b border-slate-100 dark:border-slate-800">
                      <Badge variant="info" size="sm">{item.holiday_count || 0}d</Badge>
                    </td>
                    <td className="py-2 px-3 border-r border-b border-slate-100 dark:border-slate-800 text-red-500">-{formatCurrency(item.advance_deduction || 0)}</td>
                    <td className="py-2 px-3 border-r border-b border-slate-100 dark:border-slate-800 text-green-500">+{item.sunday_work_days || 0}d</td>
                    <td className="py-2 px-3 border-r border-b border-slate-100 dark:border-slate-800 text-red-500">-{formatCurrency(item.pf_deduction)}</td>
                    <td className="py-2 px-3 border-r border-b border-slate-100 dark:border-slate-800 text-red-500">-{formatCurrency(item.esi_deduction)}</td>
                    <td className="py-2 px-3 border-r border-b border-slate-100 dark:border-slate-800 text-red-500">-{formatCurrency(item.tax_deduction)}</td>
                    <td className="py-2 px-3 border-r border-b border-slate-100 dark:border-slate-800 text-emerald-600 dark:text-emerald-400">+{formatCurrency(item.bonus)}</td>
                    <td className="py-2 px-3 border-r border-b border-slate-100 dark:border-slate-800 font-bold text-slate-800 dark:text-white">{formatCurrency(getNetSalary(item))}</td>
                    <td className="py-2 px-3 border-r border-b border-slate-100 dark:border-slate-800">
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

                  {showDetails && isExpanded && (
                    <tr className="bg-indigo-50/70 dark:bg-indigo-900/20 border-b border-slate-200 dark:border-slate-700">
                      <td colSpan={23} className="px-4 py-3">
                        <div className="flex items-center justify-between mb-3">
                          <p className="text-xs font-semibold text-indigo-700 dark:text-indigo-300">📊 Date Breakdown — {item.employee?.name}</p>
                          <button onClick={() => setExpandedItemId(null)} className="text-slate-400 hover:text-slate-600"><X size={12} /></button>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-6 gap-3 text-[11px]">
                          <div className="bg-white dark:bg-slate-800 p-2 rounded border border-slate-200 dark:border-slate-700">
                            <p className="font-semibold text-slate-600 dark:text-slate-300 mb-1">📅 Approved Leaves ({leaveDates.length} dates)</p>
                            {leaveDates.length > 0
                              ? leaveDates.map((d: string) => (
                                <div key={d} className="flex items-center gap-1 text-slate-600 dark:text-slate-300">
                                  <span>{fmt(d)}</span>
                                  {odDates.includes(d) && <span className="text-[9px] bg-purple-100 text-purple-700 px-1 rounded">OD</span>}
                                </div>
                              ))
                              : <div className="text-slate-400 italic">None</div>
                            }
                          </div>
                          <div className="bg-white dark:bg-slate-800 p-2 rounded border border-slate-200 dark:border-slate-700">
                            <p className="font-semibold text-amber-600 dark:text-amber-400 mb-1">🚫 Excluded TS ({excluded.length} dates)</p>
                            <p className="text-[9px] text-slate-400 mb-1">Leave = Missing TS → no TS deduction</p>
                            {excluded.length > 0
                              ? excluded.map(d => <div key={d} className="text-amber-700 dark:text-amber-300">{fmt(d)} ✓</div>)
                              : <div className="text-slate-400 italic">None</div>
                            }
                          </div>
                          <div className="bg-white dark:bg-slate-800 p-2 rounded border border-slate-200 dark:border-slate-700">
                            <p className="font-semibold text-blue-600 dark:text-blue-400 mb-1">🏖 Holidays ({holidayDates.length} dates)</p>
                            {holidayDates.length > 0
                              ? holidayDates.map(d => <div key={d} className="text-blue-700 dark:text-blue-300">{fmt(d)}</div>)
                              : <div className="text-slate-400 italic">None / Not applicable</div>
                            }
                          </div>
                          {odDates.length > 0 && (
                            <div className="bg-purple-50 dark:bg-purple-900/20 p-2 rounded border border-purple-200 dark:border-purple-800">
                              <p className="font-semibold text-purple-600 dark:text-purple-400 mb-1">🟣 OD Dates ({odDates.length} dates)</p>
                              <p className="text-[9px] text-slate-400 mb-1">On Duty — no deduction</p>
                              {odDates.map(d => <div key={d} className="text-purple-700 dark:text-purple-300">{fmt(d)}</div>)}
                            </div>
                          )}
                          <div className="bg-white dark:bg-slate-800 p-2 rounded border border-red-200 dark:border-red-800">
                            <p className="font-semibold text-red-600 dark:text-red-400 mb-1">⚠ Final TS Deduction ({item.missing_timesheets} days)</p>
                            {finalMissingDates.length > 0
                              ? finalMissingDates.map((d: string) => <div key={d} className="text-red-700 dark:text-red-300">{fmt(d)}</div>)
                              : item.missing_timesheets === 0
                                ? <div className="text-green-600 italic">None — ₹0 deducted ✓</div>
                                : <div className="text-red-500 italic">{item.missing_timesheets} day(s)</div>
                            }
                          </div>
                          <div className="bg-orange-50 dark:bg-orange-900/20 p-2 rounded border border-orange-200 dark:border-orange-800">
                            <p className="font-semibold text-orange-600 dark:text-orange-400 mb-1">🔴 Missing/Incomplete Punches ({((item as any).missing_punches || 0) + ((item as any).covered_by_leave_dates || []).length} days)</p>
                            <p className="text-[9px] text-slate-400 mb-1">No biometric punch (or single punch) & no LMS leave → salary deducted</p>
                            {((item as any).missing_punch_dates || []).length > 0
                              ? ((item as any).missing_punch_dates as string[]).map((d: string) => {
                                const isIncomplete = ((item as any).incomplete_punch_dates || []).includes(d);
                                const isHalfDay = ((item as any).half_day_leave_dates || []).includes(d);
                                return (
                                  <div key={d} className="text-orange-700 dark:text-orange-300">
                                    {fmt(d)} {isIncomplete && <span className="text-amber-600 text-[9px] font-bold">(⚠️ Incomplete)</span>} {isHalfDay && <span className="text-blue-600 text-[9px] font-bold">(½ Half Day)</span>}
                                  </div>
                                );
                              })
                              : (item as any).missing_punches === 0
                                ? <div className="text-green-600 italic">None — ₹0 deducted ✓</div>
                                : <div className="text-orange-500 italic">{(item as any).missing_punches} day(s)</div>
                            }
                            {(() => {
                              const coveredDates = (item as any).covered_by_leave_dates || [];
                              if (coveredDates.length === 0) return null;
                              const odDates = (item as any).od_dates || [];
                              const odCoveredDates = coveredDates.filter((d: string) => odDates.includes(d));
                              const normalCoveredDates = coveredDates.filter((d: string) => !odDates.includes(d));
                              return (
                                <div className="mt-1 pt-1 border-t border-orange-200 dark:border-orange-700">
                                  {odCoveredDates.length > 0 && (
                                    <>
                                      <p className="text-[9px] text-green-600 dark:text-green-400 font-medium mb-0.5">✓ Approved OD (no deduction):</p>
                                      {odCoveredDates.map((d: string) => {
                                        const isIncomplete = ((item as any).incomplete_punch_dates || []).includes(d);
                                        const isHalfDay = ((item as any).half_day_leave_dates || []).includes(d);
                                        return (
                                          <div key={d} className="text-green-700 dark:text-green-300">
                                            {fmt(d)} ✓ {isIncomplete && <span className="text-amber-600 text-[9px] font-bold">(⚠️ Incomplete)</span>} {isHalfDay && <span className="text-blue-600 text-[9px] font-bold">(½ Half Day)</span>}
                                          </div>
                                        );
                                      })}
                                    </>
                                  )}
                                  {normalCoveredDates.length > 0 && (
                                    <>
                                      <p className="text-[9px] text-green-600 dark:text-green-400 font-medium mt-1 mb-0.5">✓ Covered by Leave (no missing punch ded.):</p>
                                      {normalCoveredDates.map((d: string) => {
                                        const isIncomplete = ((item as any).incomplete_punch_dates || []).includes(d);
                                        const isHalfDay = ((item as any).half_day_leave_dates || []).includes(d);
                                        return (
                                          <div key={d} className="text-green-700 dark:text-green-300">
                                            {fmt(d)} ✓ {isIncomplete && <span className="text-amber-600 text-[9px] font-bold">(⚠️ Incomplete)</span>} {isHalfDay && <span className="text-blue-600 text-[9px] font-bold">(½ Half Day)</span>}
                                          </div>
                                        );
                                      })}
                                    </>
                                  )}
                                </div>
                              );
                            })()}
                            {((item as any).sandwich_dates || []).length > 0 && (
                              <div className="mt-2 pt-2 border-t border-slate-200 dark:border-slate-700">
                                <p className="font-semibold text-orange-600 dark:text-orange-400 mb-1">🥪 Sandwich Deduction ({((item as any).sandwich_dates || []).length} days)</p>
                                <p className="text-[9px] text-slate-400 mb-1">No punch on Saturday AND Monday → Sunday deducted</p>
                                {((item as any).sandwich_dates as string[]).map((d: string) => (
                                  <div key={d} className="text-orange-700 dark:text-orange-300">{fmt(d)}</div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <Modal
        isOpen={!!salarySlipModal}
        onClose={() => setSalarySlipModal(null)}
        title="Salary Details"
        size="md"
        footer={<div className="flex justify-end"><Button onClick={() => setSalarySlipModal(null)}>Close</Button></div>}
      >
        {salarySlipModal && (
          <div className="space-y-4 py-2 font-mono text-sm text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/50 p-6 rounded border border-slate-200 dark:border-slate-700 shadow-inner overflow-hidden">
            <div className="flex justify-between border-b border-slate-300 dark:border-slate-600 pb-2 font-semibold flex-wrap gap-2">
              <div>EMPNAME: <span className="text-slate-900 dark:text-white uppercase">{salarySlipModal.employee?.name}</span></div>
              <div>EMPCODE: <span className="text-slate-900 dark:text-white">{salarySlipModal.employee?.employee_code || 'N/A'}</span></div>
            </div>

            <div className="grid grid-cols-2 gap-y-4 gap-x-2 pt-2 text-xs sm:text-sm">
              <div className="col-span-2 flex gap-2">MONTHLY SAL: <span className="font-semibold text-slate-900 dark:text-white">₹{formatCurrency(salarySlipModal.monthly_salary)}</span></div>
              <div className="col-span-2 flex gap-2">TOTAL DAYS: <span className="font-semibold text-slate-900 dark:text-white">{salarySlipModal.calculation_days || salarySlipModal.working_days || 26}</span></div>

              <div>Timesheet missing days: <span className="font-semibold text-slate-900 dark:text-white">{salarySlipModal.missing_timesheets}</span></div>
              <div>TS Deduction: <span className="font-semibold text-red-600 dark:text-red-400">₹{formatCurrency(getTimesheetDeduction(salarySlipModal))}</span></div>

              <div>LMS Approved leaves: <span className="font-semibold text-slate-900 dark:text-white">{salarySlipModal.unpaid_leaves}</span></div>
              <div>leave deduction: <span className="font-semibold text-red-600 dark:text-red-400">₹{formatCurrency(salarySlipModal.leave_deduction)}</span></div>

              <div>punch Missing: <span className="font-semibold text-slate-900 dark:text-white">{(salarySlipModal as any).missing_punches || 0}</span></div>
              <div>Punch Ded.: <span className="font-semibold text-red-600 dark:text-red-400">₹{formatCurrency(getMissingPunchDeduction(salarySlipModal))}</span></div>

              <div>Half day leaves: <span className="font-semibold text-slate-900 dark:text-white">{((salarySlipModal as any).half_day_leave_dates || []).length}</span></div>
              <div>Incomplete punches: <span className="font-semibold text-slate-900 dark:text-white">{((salarySlipModal as any).incomplete_punch_dates || []).length}</span></div>

              <div>Sandwich days: <span className="font-semibold text-slate-900 dark:text-white">{(salarySlipModal as any).sandwich_deducted_days || 0}</span></div>
              <div>Sandwich Ded.: <span className="font-semibold text-red-600 dark:text-red-400">₹{formatCurrency((salarySlipModal as any).sandwich_deduction_amount || 0)}</span></div>

              <div>Permission hours: <span className="font-semibold text-slate-900 dark:text-white">{salarySlipModal.permission_hours || 0}h</span></div>
              <div>Permission Ded.: <span className="font-semibold text-red-600 dark:text-red-400">₹{formatCurrency((salarySlipModal as any).permission_deduction || 0)}</span></div>

              <div>Hourly short (biometric &lt;9h/day): <span className="font-semibold text-slate-900 dark:text-white">{(salarySlipModal as any).hourly_short_hours || 0}h</span></div>
              <div>Hourly Ded.: <span className="font-semibold text-red-600 dark:text-red-400">₹{formatCurrency((salarySlipModal as any).hourly_deduction || 0)}</span></div>

              <div>Advance Deduction: <span className="font-semibold text-red-600 dark:text-red-400">₹{formatCurrency(salarySlipModal.advance_deduction || 0)}</span></div>
              <div />

              <div>PF: <span className="font-semibold text-red-600 dark:text-red-400">₹{formatCurrency(salarySlipModal.pf_deduction || 0)}</span></div>
              <div>ESI: <span className="font-semibold text-red-600 dark:text-red-400">₹{formatCurrency(salarySlipModal.esi_deduction || 0)}</span></div>

              <div>Tax: <span className="font-semibold text-red-600 dark:text-red-400">₹{formatCurrency(salarySlipModal.tax_deduction || 0)}</span></div>
              <div>Bonus: <span className="font-semibold text-green-600 dark:text-green-400">+₹{formatCurrency(salarySlipModal.bonus || 0)}</span></div>

              <div>Sunday Work: <span className="font-semibold text-green-600 dark:text-green-400">+₹{formatCurrency(Math.round((salarySlipModal.monthly_salary / getItemDaysForRate(salarySlipModal)) * safeNumber(salarySlipModal.sunday_work_days, 0)))}</span></div>
              <div />
            </div>

            <div className="border-t border-slate-300 dark:border-slate-600 pt-4 mt-4 text-base sm:text-lg">
              Total sal after deduction: <span className="font-bold text-slate-900 dark:text-white ml-2">₹{formatCurrency(getNetSalary(salarySlipModal))}</span>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={!!missingPunchDetailsModal}
        onClose={() => setMissingPunchDetailsModal(null)}
        title={`${missingPunchDetailsModal?.employee?.name || 'Employee'} - Missing Punches`}
        size="md"
        footer={
          <div className="flex justify-end">
            <Button variant="outline" onClick={() => setMissingPunchDetailsModal(null)}>Close</Button>
          </div>
        }
      >
        {missingPunchDetailsModal && (() => {
          const item = missingPunchDetailsModal as any;
          const missingDates = item.missing_punch_dates || [];
          const incompleteDates = item.incomplete_punch_dates || [];
          const incompleteTimes = item.incomplete_punch_times || {};
          const coveredDates = item.covered_by_leave_dates || [];
          const halfDayDates = item.half_day_leave_dates || [];
          const odDates = item.od_dates || [];

          return (
            <div className="space-y-4">
              <div className="bg-orange-50 dark:bg-orange-900/20 p-4 rounded-lg border border-orange-200 dark:border-orange-800">
                <h4 className="font-semibold text-orange-700 dark:text-orange-400 mb-2 border-b border-orange-200 dark:border-orange-800 pb-2">Deducted Missing Punches ({missingDates.length} days)</h4>
                <p className="text-xs text-orange-600 dark:text-orange-500 mb-3">These days have no approved leave in the LMS, so salary is deducted.</p>
                <ul className="list-disc pl-5 space-y-1.5">
                  {missingDates.map((d: string) => {
                    const isIncomplete = incompleteDates.includes(d);
                    const punchTime = incompleteTimes[d];
                    return (
                      <li key={d} className="text-sm text-slate-700 dark:text-slate-300">
                        {new Date(d).toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short' })}
                        {isIncomplete ? <span className="text-amber-600 font-medium ml-2">(⚠️ Incomplete Punch {punchTime ? `- single punch at ${punchTime}` : '- missing in/out'})</span> : <span className="text-red-600 font-medium ml-2">(No Punch at all)</span>}
                      </li>
                    );
                  })}
                  {missingDates.length === 0 && <li className="text-sm text-slate-500">None</li>}
                </ul>
              </div>

              {coveredDates.length > 0 && (
                <div className="bg-green-50 dark:bg-green-900/20 p-4 rounded-lg border border-green-200 dark:border-green-800">
                  <h4 className="font-semibold text-green-700 dark:text-green-400 mb-2 border-b border-green-200 dark:border-green-800 pb-2">Covered by Leave ({coveredDates.length} days)</h4>
                  <p className="text-xs text-green-600 dark:text-green-500 mb-3">These days had an approved leave or OD, so the missing punch deduction is waived.</p>
                  <ul className="list-disc pl-5 space-y-1.5">
                    {coveredDates.map((d: string) => {
                      const isIncomplete = incompleteDates.includes(d);
                      const punchTime = incompleteTimes[d];
                      const isOd = odDates.includes(d);
                      const isHalfDay = halfDayDates.includes(d);
                      return (
                        <li key={d} className="text-sm text-slate-700 dark:text-slate-300">
                          {new Date(d).toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short' })}
                          {isIncomplete && <span className="text-amber-600 font-medium ml-2">(⚠️ Incomplete Punch {punchTime ? `- single punch at ${punchTime}` : ''})</span>}
                          {isOd ? <span className="text-green-600 font-medium ml-2">- OD Approved</span> : isHalfDay ? <span className="text-green-600 font-medium ml-2">- Half Day Leave Approved</span> : <span className="text-green-600 font-medium ml-2">- Leave Approved</span>}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          );
        })()}
      </Modal>
    </div>
  );
}