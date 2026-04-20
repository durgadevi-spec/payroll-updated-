import { useState, useEffect } from 'react';
import { FileText, Eye, Download, Send, CheckCircle, X, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useToast } from '../context/ToastContext';
import { formatCurrency, getMonthName } from '../lib/payrollCalculator';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Modal } from '../components/ui/Modal';
import { Badge } from '../components/ui/Badge';
import { TableSkeleton } from '../components/ui/Skeleton';

interface PayslipFull {
  id: string;
  payroll_id: string;
  employee_id: string;
  status: string;
  email_sent: boolean;
  email_sent_at: string | null;
  created_at: string;
  employee: { id: string; name: string; email: string; designation: string; department: string; bank_account: string; pf_number: string; uan_number: string };
  payroll: { id: string; month: number; year: number; status: string };
  payroll_item: { 
    basic_salary: number; 
    leave_deduction: number; 
    timesheet_deduction: number; 
    pf_deduction: number; 
    esi_deduction: number; 
    tax_deduction: number; 
    loan_deduction: number; 
    advance_deduction?: number;
    sunday_work_days?: number;
    bonus: number; 
    net_salary: number; 
    working_days: number; 
    unpaid_leaves: number 
  };
}

export function Payslips() {
  const { showToast } = useToast();
  const [payslips, setPayslips] = useState<PayslipFull[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewPayslip, setViewPayslip] = useState<PayslipFull | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sendingEmail, setSendingEmail] = useState(false);

  useEffect(() => { loadPayslips(); }, []);

  async function loadPayslips() {
    setLoading(true);
    const { data, error } = await supabase
      .from('payslips')
      .select(`*, employee:employees(id,name,email,designation,department,bank_account,pf_number,uan_number), payroll:payrolls(id,month,year,status)`)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Load payslips error:', error);
      showToast('error', 'Failed to load payslips');
      setPayslips([]);
    } else {
      setPayslips((data as PayslipFull[]) || []);
    }

    setLoading(false);
  }

  async function fetchPayslipWithItem(payslip: PayslipFull) {
    const { data } = await supabase
      .from('payroll_items')
      .select('*')
      .eq('payroll_id', payslip.payroll_id)
      .eq('employee_id', payslip.employee_id)
      .maybeSingle();
    setViewPayslip({ ...payslip, payroll_item: data });
  }

  async function sendEmails() {
    if (selectedIds.size === 0) return;
    setSendingEmail(true);

    try {
      const response = await fetch('/api/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payslipIds: Array.from(selectedIds) }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to send payslips');
      }

      showToast('success', `Payslip send complete: ${payload.sentCount} sent, ${payload.failedCount} failed`);
    } catch (error) {
      console.error('Send payslips error:', error);
      showToast('error', String((error as Error).message || 'Failed to send payslips'));
    } finally {
      setSelectedIds(new Set());
      setSendingEmail(false);
      await loadPayslips();
    }
  }

  const pendingPayslipIds = payslips.filter(ps => !ps.email_sent).map(ps => ps.id);
  const pendingEmailCount = pendingPayslipIds.length;

  async function sendAllPendingEmails() {
    if (pendingEmailCount === 0) return;
    setSendingEmail(true);

    try {
      const response = await fetch('/api/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payslipIds: pendingPayslipIds }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to send payslips');
      }

      showToast('success', `Payslip send complete: ${payload.sentCount} sent, ${payload.failedCount} failed`);
    } catch (error) {
      console.error('Send pending payslips error:', error);
      showToast('error', String((error as Error).message || 'Failed to send payslips'));
    } finally {
      setSelectedIds(new Set());
      setSendingEmail(false);
      await loadPayslips();
    }
  }

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  async function deletePayslip(payslipId: string) {
    const confirmed = window.confirm('Delete this payslip record? This will remove the payslip from the list.');
    if (!confirmed) return;

    const { error } = await supabase.from('payslips').delete().eq('id', payslipId);
    if (error) {
      showToast('error', 'Failed to delete payslip');
      return;
    }

    showToast('success', 'Payslip deleted');
    await loadPayslips();
  }

  const toggleAll = () => {
    if (selectedIds.size === payslips.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(payslips.map(p => p.id)));
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-slate-500 dark:text-slate-400 text-sm">View and distribute employee payslips</p>
        <div className="flex items-center gap-2">
          {pendingEmailCount > 0 && (
            <Button
              icon={<Send size={15} />}
              loading={sendingEmail}
              onClick={sendAllPendingEmails}
            >
              Send {pendingEmailCount} Pending Payslip{pendingEmailCount > 1 ? 's' : ''}
            </Button>
          )}
          {selectedIds.size > 0 && (
            <Button
              icon={<Send size={15} />}
              loading={sendingEmail}
              onClick={sendEmails}
            >
              Send {selectedIds.size} Payslip{selectedIds.size > 1 ? 's' : ''}
            </Button>
          )}
        </div>
      </div>
      <Card padding={false}>
        <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
          <p className="font-semibold text-slate-800 dark:text-white text-sm">All Payslips</p>
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500 dark:text-slate-400">{selectedIds.size} selected</span>
              <button onClick={() => setSelectedIds(new Set())} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                <X size={14} />
              </button>
            </div>
          )}
        </div>

        <div className="overflow-x-auto">
          {loading ? (
            <div className="p-5"><TableSkeleton rows={4} cols={6} /></div>
          ) : payslips.length === 0 ? (
            <div className="py-16 text-center">
              <FileText size={36} className="mx-auto text-slate-300 dark:text-slate-600 mb-3" />
              <p className="text-slate-500 dark:text-slate-400 text-sm">No payslips generated yet</p>
              <p className="text-slate-400 text-xs mt-1">Generate a payroll run first</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-700">
                  <th className="py-3 px-4 w-10">
                    <input type="checkbox" checked={selectedIds.size === payslips.length} onChange={toggleAll} className="rounded" />
                  </th>
                  {['Employee', 'Period', 'Email Status', 'Payslip Status', 'Actions'].map(h => (
                    <th key={h} className={`py-3 px-4 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider text-left ${h === 'Actions' ? 'text-right' : ''}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {payslips.map(ps => (
                  <tr key={ps.id} className={`border-b border-slate-50 dark:border-slate-700/30 hover:bg-slate-50/50 dark:hover:bg-slate-700/20 transition-colors ${selectedIds.has(ps.id) ? 'bg-blue-50/50 dark:bg-blue-900/10' : ''}`}>
                    <td className="py-3 px-4">
                      <input type="checkbox" checked={selectedIds.has(ps.id)} onChange={() => toggleSelect(ps.id)} className="rounded" />
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white text-xs font-bold">
                          {ps.employee?.name?.charAt(0)?.toUpperCase() || '?'}
                        </div>
                        <div>
                          <p className="font-medium text-slate-700 dark:text-slate-200 text-xs">{ps.employee?.name || '—'}</p>
                          <p className="text-slate-400 text-xs">{ps.employee?.email || '—'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <span className="text-xs text-slate-600 dark:text-slate-300">
                        {ps.payroll ? `${getMonthName(ps.payroll.month)} ${ps.payroll.year}` : '—'}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <Badge variant={ps.email_sent ? 'success' : 'neutral'} dot>
                        {ps.email_sent ? 'Sent' : 'Pending'}
                      </Badge>
                    </td>
                    <td className="py-3 px-4">
                      <Badge variant="info" dot>{ps.status}</Badge>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => fetchPayslipWithItem(ps)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors"
                          title="Preview"
                        >
                          <Eye size={14} />
                        </button>
                        <button
                          onClick={() => fetchPayslipWithItem(ps)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 transition-colors"
                          title="Download"
                        >
                          <Download size={14} />
                        </button>
                        <button
                          onClick={() => deletePayslip(ps.id)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors"
                          title="Delete payslip"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      <Modal
        isOpen={!!viewPayslip}
        onClose={() => setViewPayslip(null)}
        title="Payslip Preview"
        size="lg"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setViewPayslip(null)}>Close</Button>
            <Button icon={<Download size={14} />} onClick={() => { showToast('info', 'PDF download in production builds'); }}>Download PDF</Button>
          </div>
        }
      >
        {viewPayslip && <PayslipDocument payslip={viewPayslip} />}
      </Modal>
    </div>
  );
}

function PayslipDocument({ payslip }: { payslip: PayslipFull }) {
  const item = payslip.payroll_item;
  const emp = payslip.employee;
  const pal = payslip.payroll;

  if (!item) {
    return <p className="text-slate-500 text-sm text-center py-8">Payslip details not available</p>;
  }

  const perDaySalary = (item.basic_salary || 0) / (item.working_days || 26);
  const sundayEarnings = Math.round(perDaySalary * (item.sunday_work_days || 0) * 100) / 100;

  const earnings = [
    { label: 'Basic Salary', value: item.basic_salary },
    { label: 'Sunday Work Earnings', value: sundayEarnings },
    { label: 'HRA', value: 0 },
    { label: 'Conveyance Allowance', value: 0 },
    { label: 'Medical Allowance', value: 0 },
    { label: 'Special Allowance', value: item.bonus || 0 },
  ];

  const totalEarnings = earnings.reduce((sum, e) => sum + e.value, 0);

  const deductions = [
    { label: 'LOP', value: item.leave_deduction || 0 },
    { label: 'PF (12%)', value: item.pf_deduction || 0 },
    { label: 'ESI (0.75%)', value: item.esi_deduction || 0 },
    { label: 'Income Tax', value: item.tax_deduction || 0 },
    { label: 'Loan Deduction', value: item.loan_deduction || 0 },
    { label: 'Advance Deduction', value: item.advance_deduction || 0 },
    { 
      label: 'Total Deductions', 
      value: (item.leave_deduction || 0) + 
             (item.pf_deduction || 0) + 
             (item.esi_deduction || 0) + 
             (item.tax_deduction || 0) + 
             (item.loan_deduction || 0) + 
             (item.advance_deduction || 0), 
      isTotal: true 
    },
  ];

  return (
    <div className="bg-white text-slate-900 p-8 max-w-4xl mx-auto border shadow-sm print:shadow-none" id="payslip-content">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div className="flex gap-4">
          <div className="w-24 h-24 bg-black flex items-center justify-center rounded-sm">
            {/* Logo Placeholder - User can replace src with actual logo path */}
            <div className="text-white text-center">
              <div className="font-bold text-3xl leading-none">CT</div>
              <div className="text-[8px] uppercase tracking-tighter">Concept Trunk</div>
            </div>
          </div>
          <div>
            <h1 className="text-4xl font-black italic tracking-tighter text-slate-800 leading-none mb-1">
              CONCEPT TRUNK INTERIORS
            </h1>
            <p className="text-[10px] text-slate-500 max-w-[300px]">
              12/36 Indira Gandhi Street, Perumbakkam Main Rd, Chennai, TN - 600100
            </p>
          </div>
        </div>
      </div>

      <div className="text-center mb-6">
        <h2 className="text-lg font-bold border-y border-slate-200 py-1 uppercase tracking-widest">
          PAY SLIP — {pal ? `${getMonthName(pal.month)} ${pal.year}` : 'Month 2026'}
        </h2>
      </div>

      {/* Employee Details Table */}
      <table className="w-full border-collapse mb-6 text-xs">
        <tbody>
          <tr>
            <td className="border border-slate-300 p-2 font-bold bg-slate-50 w-1/4">Employee Code</td>
            <td className="border border-slate-300 p-2 w-1/4">{emp?.id?.substring(0, 8).toUpperCase() || '—'}</td>
            <td className="border border-slate-300 p-2 font-bold bg-slate-50 w-1/4">Employee Name</td>
            <td className="border border-slate-300 p-2 w-1/4">{emp?.name || '—'}</td>
          </tr>
          <tr>
            <td className="border border-slate-300 p-2 font-bold bg-slate-50">Designation</td>
            <td className="border border-slate-300 p-2">{emp?.designation || '—'}</td>
            <td className="border border-slate-300 p-2 font-bold bg-slate-50">Department</td>
            <td className="border border-slate-300 p-2">{emp?.department || '—'}</td>
          </tr>
          <tr>
            <td className="border border-slate-300 p-2 font-bold bg-slate-50">Site / Location</td>
            <td className="border border-slate-300 p-2">Chennai</td>
            <td className="border border-slate-300 p-2 font-bold bg-slate-50">Date of Joining</td>
            <td className="border border-slate-300 p-2">{emp?.joining_date ? new Date(emp.joining_date).toLocaleDateString() : '—'}</td>
          </tr>
          <tr>
            <td className="border border-slate-300 p-2 font-bold bg-slate-50">PAN</td>
            <td className="border border-slate-300 p-2">XXXXXXXXXX</td>
            <td className="border border-slate-300 p-2 font-bold bg-slate-50">Bank (A/C)</td>
            <td className="border border-slate-300 p-2">{emp?.bank_account || '—'}</td>
          </tr>
          <tr>
            <td className="border border-slate-300 p-2 font-bold bg-slate-50">Mode of Pay</td>
            <td className="border border-slate-300 p-2">Bank Transfer</td>
            <td className="border border-slate-300 p-2 font-bold bg-slate-50">Payable Days</td>
            <td className="border border-slate-300 p-2">{item.working_days || '0'}</td>
          </tr>
        </tbody>
      </table>

      {/* Earnings & Deductions Table */}
      <div className="flex gap-0 mb-6">
        <table className="w-1/2 border-collapse text-xs">
          <thead>
            <tr className="bg-slate-200">
              <th className="border border-slate-400 p-2 text-left">EARNINGS</th>
              <th className="border border-slate-400 p-2 text-right">Amount (INR)</th>
            </tr>
          </thead>
          <tbody>
            {earnings.map((e, index) => (
              <tr key={index}>
                <td className="border border-slate-300 p-2">{e.label}</td>
                <td className="border border-slate-300 p-2 text-right">{e.value > 0 ? e.value.toFixed(2) : '00.00'}</td>
              </tr>
            ))}
            <tr className="font-bold">
              <td className="border border-slate-300 p-2 bg-slate-50">Gross Earnings</td>
              <td className="border border-slate-300 p-2 text-right bg-slate-50">{totalEarnings.toFixed(2)}</td>
            </tr>
          </tbody>
        </table>
        <table className="w-1/2 border-collapse text-xs">
          <thead>
            <tr className="bg-slate-200">
              <th className="border border-slate-400 p-2 text-left">DEDUCTIONS</th>
              <th className="border border-slate-400 p-2 text-right">Amount (INR)</th>
            </tr>
          </thead>
          <tbody>
            {deductions.map((d, index) => (
              <tr key={index} className={d.isTotal ? 'font-bold' : ''}>
                <td className={`border border-slate-300 p-2 ${d.isTotal ? 'bg-slate-50' : ''}`}>{d.label}</td>
                <td className={`border border-slate-300 p-2 text-right ${d.isTotal ? 'bg-slate-50' : ''}`}>{d.value > 0 ? d.value.toFixed(2) : '00.00'}</td>
              </tr>
            ))}
            {/* Fill remaining rows to align with earnings table */}
            {Array.from({ length: earnings.length - (deductions.length - 1) }).map((_, i) => (
              <tr key={`fill-${i}`}>
                <td className="border border-slate-300 p-2">&nbsp;</td>
                <td className="border border-slate-300 p-2 text-right">&nbsp;</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Net Pay */}
      <div className="border border-slate-400 mb-6">
        <div className="flex justify-between p-2 bg-slate-100 font-bold text-sm border-b border-slate-400">
          <span>Net Pay (Gross - Deductions)</span>
          <span>{formatCurrency(item.net_salary)}</span>
        </div>
        <div className="p-2 text-xs italic">
          Net Pay (in words): <span className="capitalize">{item.net_salary.toLocaleString('en-IN', { style: 'currency', currency: 'INR' }).replace('₹', '')} Rupees Only</span>
        </div>
      </div>

      {/* Leave Balances */}
      <div className="mb-6">
        <p className="text-xs font-bold mb-2">Leave Balances (as on {pal ? `${getMonthName(pal.month)} ${pal.year}` : 'August 2025'})</p>
        <table className="w-full border-collapse text-[10px]">
          <thead>
            <tr className="bg-slate-200">
              <th className="border border-slate-400 p-1">Leave Type</th>
              <th className="border border-slate-400 p-1">Opening</th>
              <th className="border border-slate-400 p-1">Allotted</th>
              <th className="border border-slate-400 p-1">Avail.</th>
              <th className="border border-slate-400 p-1">Encash.</th>
              <th className="border border-slate-400 p-1">Adjust.</th>
              <th className="border border-slate-400 p-1">Closing</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="border border-slate-300 p-1 text-center">PL (Paid Leave)</td>
              <td className="border border-slate-300 p-1 text-center">0</td>
              <td className="border border-slate-300 p-1 text-center">0</td>
              <td className="border border-slate-300 p-1 text-center">0</td>
              <td className="border border-slate-300 p-1 text-center">0</td>
              <td className="border border-slate-300 p-1 text-center">0</td>
              <td className="border border-slate-300 p-1 text-center">0</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="text-[10px] space-y-2 mb-8">
        <p><strong>Reimbursements -</strong> No reimbursements claimed for this month.</p>
        <div className="space-y-0.5">
          <p><strong>Remarks:</strong></p>
          <p>- This is a computer generated payslip and does not require a physical signature.</p>
          <p>- For hygienic purposes and contactless handling, retain the digital copy.</p>
          <p>- Verify bank account details before initiating transfers.</p>
          <p>- Keep this payslip for your personal records and statutory compliance.</p>
        </div>
      </div>

      <div className="flex justify-between items-end text-xs mt-12 border-t border-slate-100 pt-4">
        <div>
          <p>Prepared By: HR / Payroll Team — Concept Trunk Interiors</p>
          <p>Generated on: {new Date().toLocaleDateString()}</p>
        </div>
        <div className="text-right italic text-slate-400">
          Electronic Copy
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, bold, valueClass }: { label: string; value: string; bold?: boolean; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className={`text-xs ${bold ? 'font-semibold text-slate-700' : 'text-slate-500'}`}>{label}</span>
      <span className={`text-xs ${bold ? 'font-bold text-slate-800' : ''} ${valueClass || 'text-slate-700'}`}>{value}</span>
    </div>
  );
}