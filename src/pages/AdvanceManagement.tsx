import React, { useState, useEffect } from 'react';
import {
  Banknote,
  Plus,
  Search,
  Filter,
  MoreVertical,
  CheckCircle2,
  Clock,
  Edit,
  Trash2,
  AlertCircle,
  UserPlus,
  Check,
  X,
  Eye,
  Hourglass,
  ShieldCheck,
  History,
  Ban,
  Paperclip,
  Download,
  XCircle
} from 'lucide-react';
import { format, addMonths } from 'date-fns';
import { useAuth } from '../context/AuthContext';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

const ADVANCE_TYPES = ['Salary Advance', 'Medical', 'Travel', 'Education', 'Emergency', 'Festival', 'Other'];
const EXPENSE_CATEGORIES = ['Project', 'Salary', 'Admin'];
const PAYMENT_MODES = ['UPI', 'Cheque', 'Bank Transfer', 'Cash'];
const SETTLEMENT_TYPES: { value: string; label: string; blurb: string }[] = [
  { value: 'Payroll', label: 'Payroll Deduction', blurb: 'Recovered from salary in installments — no receipts needed.' },
  { value: 'Reconciliation', label: 'Expense Reconciliation', blurb: 'Employee logs receipts against it; closes by refund, carry-forward, or reimbursement.' }
];
const EXPENSE_ITEM_CATEGORIES = ['Travel', 'Lodging', 'Meals', 'Materials', 'Fuel', 'Other'];
function defaultSettlementFor(expenseCategory: string) {
  return expenseCategory === 'Salary' ? 'Payroll' : 'Reconciliation';
}

type StatusTab = 'All' | 'Pending Approval' | 'Active' | 'Closed' | 'Rejected';

// Reads a File into a base64 data URL so it can travel inside the JSON body
// as the advance's proof-of-payment attachment.
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

export function AdvanceManagement() {
  const { user } = useAuth();
  const currentUserEmail = user?.email || 'admin@company.com';

  const [showAddModal, setShowAddModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const [advances, setAdvances] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    employee_id: '',
    amount: '',
    date: format(new Date(), 'yyyy-MM-dd'),
    reason: '',
    repayment_type: 'Monthly',
    installment_amount: '',
    remarks: '',
    expense_category: 'Salary',
    settlement_type: 'Payroll',
    payment_mode: '',
    payment_reference: '',
    attachment_filename: '',
    attachment_data: ''
  });
  const [attachmentError, setAttachmentError] = useState('');

  // --- New: advance request workflow state ---
  const [activeTab, setActiveTab] = useState<StatusTab>('All');
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [requestSubmitting, setRequestSubmitting] = useState(false);
  const [requestForm, setRequestForm] = useState({
    employee_id: '',
    amount: '',
    date: format(new Date(), 'yyyy-MM-dd'),
    advance_type: 'Salary Advance',
    reason: '',
    repayment_type: 'Monthly',
    no_of_installments: '1',
    remarks: ''
  });

  const [approvingAdv, setApprovingAdv] = useState<any | null>(null);
  const [approveInstallment, setApproveInstallment] = useState('');
  const [approveSubmitting, setApproveSubmitting] = useState(false);
  const [approveExpenseCategory, setApproveExpenseCategory] = useState('Salary');
  const [approveSettlementType, setApproveSettlementType] = useState('Payroll');
  const [approvePaymentMode, setApprovePaymentMode] = useState('');
  const [approvePaymentReference, setApprovePaymentReference] = useState('');
  const [approveAttachmentFilename, setApproveAttachmentFilename] = useState('');
  const [approveAttachmentData, setApproveAttachmentData] = useState('');
  const [approveError, setApproveError] = useState('');

  const [rejectingAdv, setRejectingAdv] = useState<any | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectSubmitting, setRejectSubmitting] = useState(false);

  const [detailsAdv, setDetailsAdv] = useState<any | null>(null);
  const [expenseItems, setExpenseItems] = useState<any[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemForm, setItemForm] = useState({ date: format(new Date(), 'yyyy-MM-dd'), category: 'Travel', description: '', amount: '', receipt_filename: '', receipt_data: '' });
  const [itemSubmitting, setItemSubmitting] = useState(false);
  const [itemError, setItemError] = useState('');
  const [showReconcileModal, setShowReconcileModal] = useState(false);
  const [reconcileAction, setReconcileAction] = useState('');
  const [reconcileReference, setReconcileReference] = useState('');
  const [reconcileNotes, setReconcileNotes] = useState('');
  const [reconcileSubmitting, setReconcileSubmitting] = useState(false);
  const [reconcileError, setReconcileError] = useState('');

  const [closingAdv, setClosingAdv] = useState<any | null>(null);
  const [closeReason, setCloseReason] = useState('');
  const [closeSubmitting, setCloseSubmitting] = useState(false);
  const [closeError, setCloseError] = useState('');

  useEffect(() => {
    if (detailsAdv && detailsAdv.settlement_type === 'Reconciliation') {
      fetchExpenseItems(detailsAdv.id);
    } else {
      setExpenseItems([]);
    }
    setShowReconcileModal(false);
    setReconcileAction('');
    setReconcileReference('');
    setReconcileNotes('');
    setReconcileError('');
  }, [detailsAdv?.id]);

  async function fetchExpenseItems(advanceId: string) {
    setItemsLoading(true);
    try {
      const res = await fetch(`/api/advances/${advanceId}/expense-items`);
      if (res.ok) setExpenseItems(await res.json());
    } catch (e) { console.error(e); }
    setItemsLoading(false);
  }

  async function handleItemReceiptChange(file: File | null) {
    if (!file) {
      setItemForm(prev => ({ ...prev, receipt_filename: '', receipt_data: '' }));
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setItemError('Receipt too large — please keep it under 5MB');
      return;
    }
    setItemError('');
    const dataUrl = await fileToDataUrl(file);
    setItemForm(prev => ({ ...prev, receipt_filename: file.name, receipt_data: dataUrl }));
  }

  async function handleAddExpenseItem() {
    if (!detailsAdv || !itemForm.date || !itemForm.category || !itemForm.amount) {
      setItemError('Date, category and amount are required');
      return;
    }
    setItemSubmitting(true);
    setItemError('');
    try {
      const res = await fetch(`/api/advances/${detailsAdv.id}/expense-items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...itemForm, created_by: currentUserEmail })
      });
      if (res.ok) {
        setItemForm({ date: format(new Date(), 'yyyy-MM-dd'), category: 'Travel', description: '', amount: '', receipt_filename: '', receipt_data: '' });
        await fetchExpenseItems(detailsAdv.id);
        await fetchAdvances();
        // Keep the drawer's copy of the advance (reconciled_amount) in sync without closing it
        setDetailsAdv((prev: any) => prev ? { ...prev, reconciled_amount: (Number(prev.reconciled_amount) || 0) + (parseFloat(itemForm.amount) || 0) } : prev);
      } else {
        const err = await res.json().catch(() => ({}));
        setItemError(err.error || 'Failed to add expense item');
      }
    } catch (e) { console.error(e); }
    setItemSubmitting(false);
  }

  async function handleDeleteExpenseItem(itemId: string, amount: number) {
    if (!detailsAdv) return;
    try {
      const res = await fetch(`/api/advances/${detailsAdv.id}/expense-items/${itemId}`, { method: 'DELETE' });
      if (res.ok) {
        await fetchExpenseItems(detailsAdv.id);
        await fetchAdvances();
        setDetailsAdv((prev: any) => prev ? { ...prev, reconciled_amount: Math.max(0, (Number(prev.reconciled_amount) || 0) - amount) } : prev);
      }
    } catch (e) { console.error(e); }
  }

  async function downloadReceipt(advanceId: string, itemId: string, filename: string) {
    try {
      const res = await fetch(`/api/advances/${advanceId}/expense-items/${itemId}/receipt`);
      if (!res.ok) return;
      const { receipt_data } = await res.json();
      const link = document.createElement('a');
      link.href = receipt_data;
      link.download = filename || 'receipt';
      link.click();
    } catch (e) { console.error(e); }
  }

  function reconciliationGap() {
    if (!detailsAdv) return 0;
    return Math.round((Number(detailsAdv.amount) - (Number(detailsAdv.reconciled_amount) || 0)) * 100) / 100;
  }

  async function handleReconcileConfirm() {
    if (!detailsAdv || !reconcileAction) { setReconcileError('Choose how to settle this advance'); return; }
    setReconcileSubmitting(true);
    setReconcileError('');
    try {
      const res = await fetch(`/api/advances/${detailsAdv.id}/reconcile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: reconcileAction, reference: reconcileReference, notes: reconcileNotes, closed_by: currentUserEmail })
      });
      if (res.ok) {
        setShowReconcileModal(false);
        setDetailsAdv(null);
        fetchAdvances();
      } else {
        const err = await res.json().catch(() => ({}));
        setReconcileError(err.error || 'Failed to reconcile advance');
      }
    } catch (e) { console.error(e); }
    setReconcileSubmitting(false);
  }

  function openCloseModal(adv: any) {
    setClosingAdv(adv);
    setCloseReason('');
    setCloseError('');
  }

  async function handleCloseConfirm() {
    if (!closingAdv) return;
    if (!closeReason.trim()) { setCloseError('A reason is required to close this advance'); return; }
    setCloseSubmitting(true);
    setCloseError('');
    try {
      const res = await fetch(`/api/advances/${closingAdv.id}/manual-close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ closed_by: currentUserEmail, reason: closeReason.trim() })
      });
      if (res.ok) {
        setClosingAdv(null);
        setCloseReason('');
        if (detailsAdv?.id === closingAdv.id) setDetailsAdv(null);
        fetchAdvances();
      } else {
        const err = await res.json().catch(() => ({}));
        setCloseError(err.error || 'Failed to close advance');
      }
    } catch (e) { console.error(e); setCloseError('Failed to close advance'); }
    setCloseSubmitting(false);
  }

  useEffect(() => {
    fetchAdvances();
    fetchEmployees();
  }, []);

  async function fetchAdvances() {
    setLoading(true);
    try {
      const res = await fetch('/api/advances');
      if (res.ok) setAdvances(await res.json());
    } catch (e) { console.error(e); }
    setLoading(false);
  }

  async function fetchEmployees() {
    try {
      const res = await fetch('/api/employees');
      if (res.ok) setEmployees(await res.json());
    } catch (e) { console.error(e); }
  }

  function resetAddForm() {
    setFormData({
      employee_id: '', amount: '', date: format(new Date(), 'yyyy-MM-dd'), reason: '',
      repayment_type: 'Monthly', installment_amount: '', remarks: '',
      expense_category: 'Salary', settlement_type: 'Payroll', payment_mode: '', payment_reference: '', attachment_filename: '', attachment_data: ''
    });
    setAttachmentError('');
  }

  async function handleAttachmentChange(file: File | null) {
    if (!file) {
      setFormData(prev => ({ ...prev, attachment_filename: '', attachment_data: '' }));
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setAttachmentError('File too large — please keep attachments under 5MB');
      return;
    }
    setAttachmentError('');
    const dataUrl = await fileToDataUrl(file);
    setFormData(prev => ({ ...prev, attachment_filename: file.name, attachment_data: dataUrl }));
  }

  async function handleSubmit() {
    if (!formData.employee_id || !formData.amount) return;
    if (!formData.payment_mode) { setAttachmentError('Payment mode is required'); return; }
    // Attachment is only mandatory for a brand-new entry; an edit can keep the one already on file.
    if (!editingId && !formData.attachment_data) { setAttachmentError('Proof of payment attachment is required'); return; }
    setSubmitting(true);
    try {
      const url = editingId ? `/api/advances/${editingId}` : '/api/advances';
      const method = editingId ? 'PUT' : 'POST';

      const payload: any = { ...formData };
      if (editingId && !formData.attachment_data) {
        // No new file chosen while editing — don't overwrite the stored attachment.
        delete payload.attachment_data;
        delete payload.attachment_filename;
      }

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        setShowAddModal(false);
        setEditingId(null);
        resetAddForm();
        fetchAdvances();
      } else {
        const err = await res.json().catch(() => ({}));
        setAttachmentError(err.error || 'Failed to save advance');
      }
    } catch (e) { console.error(e); }
    setSubmitting(false);
  }

  function handleEditClick(adv: any) {
    setFormData({
      employee_id: adv.employee_id,
      amount: adv.amount,
      date: format(new Date(adv.date), 'yyyy-MM-dd'),
      reason: adv.reason || '',
      repayment_type: adv.repayment_type || 'Monthly',
      installment_amount: adv.installment_amount || '',
      remarks: adv.remarks || '',
      expense_category: adv.expense_category || 'Salary',
      settlement_type: adv.settlement_type || defaultSettlementFor(adv.expense_category || 'Salary'),
      payment_mode: adv.payment_mode || '',
      payment_reference: adv.payment_reference || '',
      attachment_filename: '',
      attachment_data: ''
    });
    setAttachmentError('');
    setEditingId(adv.id);
    setShowAddModal(true);
  }

  async function handleDeleteClick(advId: string) {
    if (!confirm('Are you sure you want to delete this advance?')) return;
    try {
      const res = await fetch(`/api/advances/${advId}`, { method: 'DELETE' });
      if (res.ok) fetchAdvances();
    } catch (e) { console.error(e); }
  }

  // --- New: raise / approve / reject handlers ---
  function resetRequestForm() {
    setRequestForm({
      employee_id: '',
      amount: '',
      date: format(new Date(), 'yyyy-MM-dd'),
      advance_type: 'Salary Advance',
      reason: '',
      repayment_type: 'Monthly',
      no_of_installments: '1',
      remarks: ''
    });
  }

  function openRequestModal() {
    resetRequestForm();
    setShowRequestModal(true);
  }

  const requestInstallmentPreview = (() => {
    const amt = parseFloat(requestForm.amount) || 0;
    if (requestForm.repayment_type === 'One-time') return amt;
    const n = Math.max(1, parseInt(requestForm.no_of_installments || '1', 10) || 1);
    return Math.ceil((amt / n) * 100) / 100;
  })();

  async function handleRequestSubmit() {
    if (!requestForm.employee_id || !requestForm.amount) return;
    setRequestSubmitting(true);
    try {
      const res = await fetch('/api/advances/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestForm)
      });
      if (res.ok) {
        setShowRequestModal(false);
        resetRequestForm();
        setActiveTab('Pending Approval');
        fetchAdvances();
      }
    } catch (e) { console.error(e); }
    setRequestSubmitting(false);
  }

  function openApproveModal(adv: any) {
    setApprovingAdv(adv);
    setApproveInstallment(String(adv.installment_amount || ''));
    const cat = adv.expense_category || (adv.advance_type === 'Travel' || adv.advance_type === 'Other' ? 'Admin' : 'Salary');
    setApproveExpenseCategory(cat);
    setApproveSettlementType(adv.settlement_type || defaultSettlementFor(cat));
    setApprovePaymentMode('');
    setApprovePaymentReference('');
    setApproveAttachmentFilename('');
    setApproveAttachmentData('');
    setApproveError('');
  }

  async function handleApproveAttachmentChange(file: File | null) {
    if (!file) {
      setApproveAttachmentFilename('');
      setApproveAttachmentData('');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setApproveError('File too large — please keep attachments under 5MB');
      return;
    }
    setApproveError('');
    const dataUrl = await fileToDataUrl(file);
    setApproveAttachmentFilename(file.name);
    setApproveAttachmentData(dataUrl);
  }

  async function handleApproveConfirm() {
    if (!approvingAdv) return;
    if (!approvePaymentMode) { setApproveError('Payment mode is required to disburse'); return; }
    if (!approveAttachmentData) { setApproveError('Proof of payment attachment is required to disburse'); return; }
    setApproveSubmitting(true);
    try {
      const res = await fetch(`/api/advances/${approvingAdv.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          approved_by: currentUserEmail,
          installment_amount: approveInstallment,
          expense_category: approveExpenseCategory,
          settlement_type: approveSettlementType,
          payment_mode: approvePaymentMode,
          payment_reference: approvePaymentReference,
          attachment_filename: approveAttachmentFilename,
          attachment_data: approveAttachmentData
        })
      });
      if (res.ok) {
        setApprovingAdv(null);
        fetchAdvances();
      } else {
        const err = await res.json().catch(() => ({}));
        setApproveError(err.error || 'Failed to approve request');
      }
    } catch (e) { console.error(e); }
    setApproveSubmitting(false);
  }

  async function handleRejectConfirm() {
    if (!rejectingAdv) return;
    setRejectSubmitting(true);
    try {
      const res = await fetch(`/api/advances/${rejectingAdv.id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rejected_by: currentUserEmail, rejection_reason: rejectReason })
      });
      if (res.ok) {
        setRejectingAdv(null);
        setRejectReason('');
        fetchAdvances();
      }
    } catch (e) { console.error(e); }
    setRejectSubmitting(false);
  }

  async function downloadAttachment(advanceId: string) {
    try {
      const res = await fetch(`/api/advances/${advanceId}/attachment`);
      if (!res.ok) return;
      const { attachment_filename, attachment_data } = await res.json();
      const link = document.createElement('a');
      link.href = attachment_data;
      link.download = attachment_filename || 'proof-of-payment';
      link.click();
    } catch (e) { console.error(e); }
  }

  function buildSchedule(adv: any) {
    const n = Math.max(1, parseInt(adv.no_of_installments || '1', 10) || 1);
    const recovered = Number(adv.amount) - Number(adv.balance);
    const perInstallment = Number(adv.installment_amount) || (Number(adv.amount) / n);
    const startDate = adv.disbursed_at ? new Date(adv.disbursed_at) : new Date(adv.date);
    let cumulative = 0;
    return Array.from({ length: n }).map((_, i) => {
      cumulative += perInstallment;
      const due = addMonths(startDate, i + 1);
      return {
        index: i + 1,
        dueDate: due,
        amount: Math.min(perInstallment, Math.max(0, Number(adv.amount) - (perInstallment * i))),
        status: recovered >= cumulative - 0.01 ? 'Paid' : 'Pending'
      };
    });
  }

  const activeAdvances = advances.filter(a => a.status === 'Active');
  const pendingAdvances = advances.filter(a => a.status === 'Pending Approval');
  const totalAdvances = activeAdvances.reduce((sum, a) => sum + Number(a.balance), 0);
  const expectedMonthly = activeAdvances.reduce((sum, a) => sum + Number(a.installment_amount), 0);
  const recoveredAmount = advances.reduce((sum, a) => sum + (Number(a.amount) - Number(a.balance)), 0);
  const pendingRequestAmount = pendingAdvances.reduce((sum, a) => sum + Number(a.amount), 0);

  const tabCounts: Record<StatusTab, number> = {
    'All': advances.length,
    'Pending Approval': advances.filter(a => a.status === 'Pending Approval').length,
    'Active': advances.filter(a => a.status === 'Active').length,
    'Closed': advances.filter(a => a.status === 'Closed').length,
    'Rejected': advances.filter(a => a.status === 'Rejected').length,
  };

  const visibleAdvances = advances
    .filter(a => activeTab === 'All' || a.status === activeTab)
    .filter(a => !searchQuery || a.employee_name?.toLowerCase().includes(searchQuery.toLowerCase()));

  const downloadAdvancesPDF = () => {
    try {
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const pageWidth = doc.internal.pageSize.getWidth();

      doc.setFillColor(15, 23, 42);
      doc.rect(0, 0, pageWidth, 20, 'F');
      
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.text('ADVANCES REPORT', 15, 13);
      
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(148, 163, 184);
      const printDate = new Date().toLocaleDateString('en-US');
      doc.text(`Printed: ${printDate} | Knockturn Payroll System`, 15, 28);
      
      const tableData = visibleAdvances.map((adv: any) => [
        adv.employee_name,
        format(new Date(adv.date), 'dd MMM yyyy'),
        adv.expense_category || '-',
        adv.advance_type || '-',
        `Rs. ${Number(adv.amount).toLocaleString()}`,
        `Rs. ${Number(adv.balance).toLocaleString()}`,
        adv.repayment_type || '-',
        adv.status
      ]);

      autoTable(doc, {
        startY: 35,
        head: [['Employee', 'Date', 'Category', 'Type', 'Amount', 'Balance', 'Repayment', 'Status']],
        body: tableData,
        theme: 'striped',
        headStyles: { fillColor: [79, 70, 229], textColor: 255 },
        styles: { fontSize: 9 },
        margin: { left: 15, right: 15 }
      });
      
      doc.save('advances_report.pdf');
    } catch (e) {
      console.error('Failed to generate PDF:', e);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Advance Management</h1>
          <p className="text-slate-500 text-sm mt-1">Manage employee salary advances, requests and deductions</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={openRequestModal}
            className="flex items-center gap-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 px-4 py-2 rounded-lg text-sm font-medium transition-colors shadow-sm"
          >
            <UserPlus size={16} />
            Raise Advance Request
          </button>
          <button
            onClick={() => {
              setEditingId(null);
              resetAddForm();
              setShowAddModal(true);
            }}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors shadow-sm"
          >
            <Plus size={16} />
            New Advance
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard label="Total Active Advances" value={`₹${totalAdvances.toLocaleString()}`} subValue={`${activeAdvances.length} Employees`} icon={<Banknote size={20} />} color="blue" />
        <StatCard label="Monthly Deduction" value={`₹${expectedMonthly.toLocaleString()}`} subValue="Expected this month" icon={<Clock size={20} />} color="orange" />
        <StatCard label="Recovered Amount" value={`₹${recoveredAmount.toLocaleString()}`} subValue="Total recovered" icon={<CheckCircle2 size={20} />} color="green" />
        <StatCard label="Pending Balance" value={`₹${totalAdvances.toLocaleString()}`} subValue="Across all employees" icon={<AlertCircle size={20} />} color="purple" />
        <StatCard label="Pending Requests" value={`₹${pendingRequestAmount.toLocaleString()}`} subValue={`${pendingAdvances.length} Awaiting approval`} icon={<Hourglass size={20} />} color="amber" />
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-200 dark:border-slate-700 flex flex-col gap-4 bg-slate-50 dark:bg-slate-800/50">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <h3 className="font-semibold text-slate-800 dark:text-white">All Advances</h3>
            <div className="flex items-center gap-3 w-full sm:w-auto">
              <div className="relative flex-1 sm:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                <input
                  type="text"
                  placeholder="Search employees..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-sm focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <button className="p-2 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 rounded-lg text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-700">
                <Filter size={16} />
              </button>
              <button 
                onClick={downloadAdvancesPDF}
                className="flex items-center gap-2 p-2 px-3 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 rounded-lg text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 text-sm font-medium transition-colors"
                title="Download PDF"
              >
                <Download size={16} />
                <span className="hidden sm:inline">PDF</span>
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2 overflow-x-auto">
            {(['All', 'Pending Approval', 'Active', 'Closed', 'Rejected'] as StatusTab[]).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${activeTab === tab
                  ? 'bg-blue-600 border-blue-600 text-white'
                  : 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
                  }`}
              >
                {tab} <span className="opacity-70">({tabCounts[tab]})</span>
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-50 dark:bg-slate-800/80 text-slate-500 dark:text-slate-400 uppercase text-xs">
              <tr>
                <th className="px-6 py-4 font-medium">Employee</th>
                <th className="px-6 py-4 font-medium">Date & Reason</th>
                <th className="px-6 py-4 font-medium">Amount Info</th>
                <th className="px-6 py-4 font-medium">Repayment</th>
                <th className="px-6 py-4 font-medium">Source</th>
                <th className="px-6 py-4 font-medium">Status</th>
                <th className="px-6 py-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {loading ? (
                <tr><td colSpan={7} className="px-6 py-8 text-center text-slate-500">Loading advances...</td></tr>
              ) : visibleAdvances.length === 0 ? (
                <tr><td colSpan={7} className="px-6 py-8 text-center text-slate-500">No advances found</td></tr>
              ) : visibleAdvances.map((adv) => (
                <tr key={adv.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 flex items-center justify-center font-bold text-xs">
                        {adv.employee_name?.charAt(0).toUpperCase() || '?'}
                      </div>
                      <div>
                        <div className="font-medium text-slate-900 dark:text-white">{adv.employee_name}</div>
                        <div className="text-xs text-slate-500">{adv.department || '—'}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-slate-900 dark:text-white">{format(new Date(adv.date), 'MMM dd, yyyy')}</div>
                    <div className="text-xs text-slate-500">{adv.reason || '—'}</div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="font-medium text-slate-900 dark:text-white">₹{Number(adv.amount).toLocaleString()}</div>
                    {adv.settlement_type === 'Reconciliation' ? (
                      <div className="text-xs text-slate-500">Logged: <span className="font-medium text-purple-600 dark:text-purple-400">₹{(Number(adv.reconciled_amount) || 0).toLocaleString()}</span></div>
                    ) : (
                      <div className="text-xs text-slate-500">Balance: <span className="font-medium text-blue-600 dark:text-blue-400">₹{Number(adv.balance).toLocaleString()}</span></div>
                    )}
                    {(adv.status === 'Active' || adv.status === 'Closed') && adv.payment_mode && (
                      <div className="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5">
                        {adv.payment_mode}
                        {adv.has_attachment && <Paperclip size={10} />}
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-slate-900 dark:text-white">{adv.repayment_type}</div>
                    <div className="text-xs text-slate-500">₹{Number(adv.installment_amount).toLocaleString()} / mo</div>
                  </td>
                  <td className="px-6 py-4">
                    {adv.request_source === 'Employee Request' ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-teal-50 text-teal-700 dark:bg-teal-900/20 dark:text-teal-400 border border-teal-200 dark:border-teal-800">
                        <UserPlus size={12} /> Employee
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                        <ShieldCheck size={12} /> Admin
                      </span>
                    )}
                    <div className="text-xs text-slate-500 mt-1">{adv.advance_type || 'Salary Advance'}</div>
                  </td>
                  <td className="px-6 py-4">
                    {adv.status === 'Active' && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border border-blue-200 dark:border-blue-800">
                        Active
                      </span>
                    )}
                    {adv.status === 'Pending Approval' && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
                        <Hourglass size={12} /> Pending
                      </span>
                    )}
                    {adv.status === 'Rejected' && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border border-red-200 dark:border-red-800">
                        <Ban size={12} /> Rejected
                      </span>
                    )}
                    {adv.status === 'Closed' && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                        Closed
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center justify-end gap-2">
                      {adv.status === 'Pending Approval' ? (
                        <>
                          <button onClick={() => openApproveModal(adv)} title="Approve" className="p-1.5 text-slate-400 hover:text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-md transition-colors">
                            <Check size={16} />
                          </button>
                          <button onClick={() => setRejectingAdv(adv)} title="Reject" className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md transition-colors">
                            <X size={16} />
                          </button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => handleEditClick(adv)} title="Edit" className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-md transition-colors">
                            <Edit size={16} />
                          </button>
                          <button onClick={() => handleDeleteClick(adv.id)} title="Delete" className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md transition-colors">
                            <Trash2 size={16} />
                          </button>
                          {adv.status === 'Active' && adv.settlement_type !== 'Reconciliation' && (
                            <button onClick={() => openCloseModal(adv)} title="Close / write off" className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20 rounded-md transition-colors">
                              <XCircle size={16} />
                            </button>
                          )}
                        </>
                      )}
                      <button onClick={() => setDetailsAdv(adv)} title="View details" className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-md transition-colors">
                        <Eye size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add/Edit Advance Modal (Admin direct entry) */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xl w-full max-w-2xl border border-slate-200 dark:border-slate-700 max-h-[90vh] flex flex-col my-8">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center shrink-0">
              <h2 className="text-xl font-bold text-slate-800 dark:text-white">{editingId ? 'Edit Advance' : 'New Advance Entry'}</h2>
              <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
                <MoreVertical size={20} className="rotate-45" />
              </button>
            </div>
            <div className="p-6 space-y-4 overflow-y-auto">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Employee</label>
                  <select
                    value={formData.employee_id}
                    onChange={e => setFormData({ ...formData, employee_id: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Select Employee</option>
                    {employees.map(emp => (
                      <option key={emp.id} value={emp.id}>{emp.name} ({emp.department || 'No Dept'})</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Advance Amount</label>
                  <input
                    type="number"
                    value={formData.amount}
                    onChange={e => setFormData({ ...formData, amount: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm focus:ring-2 focus:ring-blue-500"
                    placeholder="₹"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Date</label>
                  <input
                    type="date"
                    value={formData.date}
                    onChange={e => setFormData({ ...formData, date: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                {formData.settlement_type === 'Payroll' && (
                  <>
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Repayment Type</label>
                      <select
                        value={formData.repayment_type}
                        onChange={e => setFormData({ ...formData, repayment_type: e.target.value })}
                        className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="Monthly">Monthly Deduction</option>
                        <option value="One-time">One-time Deduction</option>
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Installment Amount</label>
                      <input
                        type="number"
                        value={formData.installment_amount}
                        onChange={e => setFormData({ ...formData, installment_amount: e.target.value })}
                        className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm focus:ring-2 focus:ring-blue-500"
                        placeholder="₹ per month"
                      />
                    </div>
                  </>
                )}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Reason</label>
                  <input
                    type="text"
                    value={formData.reason}
                    onChange={e => setFormData({ ...formData, reason: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm focus:ring-2 focus:ring-blue-500"
                    placeholder="E.g., Medical Emergency"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Expense Category</label>
                  <select
                    value={formData.expense_category}
                    onChange={e => {
                      const cat = e.target.value;
                      setFormData(prev => ({ ...prev, expense_category: cat, settlement_type: defaultSettlementFor(cat) }));
                    }}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm focus:ring-2 focus:ring-blue-500"
                  >
                    {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c} Expense</option>)}
                  </select>
                  <p className="text-xs text-slate-400">Head this gets booked under when the advance closes</p>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Settlement Type</label>
                  <select
                    value={formData.settlement_type}
                    onChange={e => setFormData({ ...formData, settlement_type: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm focus:ring-2 focus:ring-blue-500"
                  >
                    {SETTLEMENT_TYPES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                  <p className="text-xs text-slate-400">{SETTLEMENT_TYPES.find(s => s.value === formData.settlement_type)?.blurb}</p>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Payment Mode</label>
                  <select
                    value={formData.payment_mode}
                    onChange={e => setFormData({ ...formData, payment_mode: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Select Mode</option>
                    {PAYMENT_MODES.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    {formData.payment_mode === 'UPI' ? 'UPI Transaction ID' : formData.payment_mode === 'Cheque' ? 'Cheque Number' : 'Reference No.'}
                  </label>
                  <input
                    type="text"
                    value={formData.payment_reference}
                    onChange={e => setFormData({ ...formData, payment_reference: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm focus:ring-2 focus:ring-blue-500"
                    placeholder={formData.payment_mode === 'UPI' ? 'e.g., 234567891234' : formData.payment_mode === 'Cheque' ? 'e.g., 000123' : 'Optional'}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <Paperclip size={14} /> Proof of Payment {editingId ? '(leave empty to keep existing file)' : ''}
                </label>
                <input
                  type="file"
                  accept="image/*,.pdf"
                  onChange={e => handleAttachmentChange(e.target.files?.[0] || null)}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm file:mr-3 file:py-1 file:px-3 file:rounded-md file:border-0 file:bg-blue-50 file:text-blue-700 dark:file:bg-blue-900/30 dark:file:text-blue-400"
                />
                {formData.attachment_filename && <p className="text-xs text-green-600 dark:text-green-400">Attached: {formData.attachment_filename}</p>}
                <p className="text-xs text-slate-400">UPI screenshot, scanned cheque, or bank transfer receipt — required for reconciliation.</p>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Remarks</label>
                <textarea
                  rows={3}
                  value={formData.remarks}
                  onChange={e => setFormData({ ...formData, remarks: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm focus:ring-2 focus:ring-blue-500"
                  placeholder="Any additional details..."
                />
              </div>
              {attachmentError && (
                <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
                  {attachmentError}
                </div>
              )}
            </div>
            <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex justify-end gap-3 shrink-0">
              <button
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting || !formData.employee_id || !formData.amount}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
              >
                {submitting ? 'Saving...' : 'Save Advance'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Raise Advance Request Modal (Employee self-service request) */}
      {showRequestModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xl w-full max-w-3xl border border-slate-200 dark:border-slate-700 max-h-[90vh] flex flex-col my-8">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center shrink-0">
              <div>
                <h2 className="text-xl font-bold text-slate-800 dark:text-white">Raise Advance Request</h2>
                <p className="text-xs text-slate-500 mt-0.5">Submitted requests go to Pending Approval until an admin approves them.</p>
              </div>
              <button onClick={() => setShowRequestModal(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-4 overflow-y-auto">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Employee</label>
                  <select
                    value={requestForm.employee_id}
                    onChange={e => setRequestForm({ ...requestForm, employee_id: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Select Employee</option>
                    {employees.map(emp => (
                      <option key={emp.id} value={emp.id}>{emp.name} ({emp.department || 'No Dept'})</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Advance Type</label>
                  <select
                    value={requestForm.advance_type}
                    onChange={e => setRequestForm({ ...requestForm, advance_type: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm focus:ring-2 focus:ring-blue-500"
                  >
                    {ADVANCE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Amount Requested</label>
                  <input
                    type="number"
                    value={requestForm.amount}
                    onChange={e => setRequestForm({ ...requestForm, amount: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm focus:ring-2 focus:ring-blue-500"
                    placeholder="₹"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Date Needed</label>
                  <input
                    type="date"
                    value={requestForm.date}
                    onChange={e => setRequestForm({ ...requestForm, date: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Preferred Repayment</label>
                  <select
                    value={requestForm.repayment_type}
                    onChange={e => setRequestForm({ ...requestForm, repayment_type: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="Monthly">Split across installments</option>
                    <option value="One-time">One-time deduction</option>
                  </select>
                </div>
                {requestForm.repayment_type === 'Monthly' && (
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-slate-700 dark:text-slate-300">No. of Installments</label>
                    <input
                      type="number"
                      min={1}
                      value={requestForm.no_of_installments}
                      onChange={e => setRequestForm({ ...requestForm, no_of_installments: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm focus:ring-2 focus:ring-blue-500"
                      placeholder="e.g., 3"
                    />
                  </div>
                )}
                <div className="col-span-2 space-y-1.5">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Reason</label>
                  <input
                    type="text"
                    value={requestForm.reason}
                    onChange={e => setRequestForm({ ...requestForm, reason: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm focus:ring-2 focus:ring-blue-500"
                    placeholder="E.g., Medical Emergency"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Remarks</label>
                <textarea
                  rows={2}
                  value={requestForm.remarks}
                  onChange={e => setRequestForm({ ...requestForm, remarks: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm focus:ring-2 focus:ring-blue-500"
                  placeholder="Any additional details..."
                />
              </div>
              {Number(requestForm.amount) > 0 && (
                <div className="bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-3 text-sm text-slate-600 dark:text-slate-300">
                  Estimated deduction: <span className="font-semibold text-slate-900 dark:text-white">₹{requestInstallmentPreview.toLocaleString()}</span>
                  {requestForm.repayment_type === 'Monthly' ? ' per month' : ' (one-time)'} once approved.
                </div>
              )}
            </div>
            <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex justify-end gap-3 shrink-0">
              <button
                onClick={() => setShowRequestModal(false)}
                className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleRequestSubmit}
                disabled={requestSubmitting || !requestForm.employee_id || !requestForm.amount}
                className="px-4 py-2 text-sm font-medium text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
              >
                {requestSubmitting ? 'Submitting...' : 'Submit Request'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Approve Modal */}
      {approvingAdv && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xl w-full max-w-lg overflow-hidden border border-slate-200 dark:border-slate-700 max-h-[90vh] overflow-y-auto my-8">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800">
              <h2 className="text-lg font-bold text-slate-800 dark:text-white">Approve Advance Request</h2>
            </div>
            <div className="p-6 space-y-4 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">Employee</span><span className="font-medium text-slate-900 dark:text-white">{approvingAdv.employee_name}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Amount</span><span className="font-medium text-slate-900 dark:text-white">₹{Number(approvingAdv.amount).toLocaleString()}</span></div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Expense Category</label>
                  <select
                    value={approveExpenseCategory}
                    onChange={e => {
                      const cat = e.target.value;
                      setApproveExpenseCategory(cat);
                      setApproveSettlementType(defaultSettlementFor(cat));
                    }}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm focus:ring-2 focus:ring-blue-500"
                  >
                    {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c} Expense</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Settlement Type</label>
                  <select
                    value={approveSettlementType}
                    onChange={e => setApproveSettlementType(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm focus:ring-2 focus:ring-blue-500"
                  >
                    {SETTLEMENT_TYPES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </div>
              </div>
              <p className="text-xs text-slate-400 -mt-2">{SETTLEMENT_TYPES.find(s => s.value === approveSettlementType)?.blurb}</p>
              {approveSettlementType === 'Payroll' ? (
                <>
                  <div className="flex justify-between"><span className="text-slate-500">Repayment</span><span className="font-medium text-slate-900 dark:text-white">{approvingAdv.repayment_type} ({approvingAdv.no_of_installments || 1} installments)</span></div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Monthly Installment Amount</label>
                    <input
                      type="number"
                      value={approveInstallment}
                      onChange={e => setApproveInstallment(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </>
              ) : (
                <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
                  No payroll deduction — the employee will log receipts against this advance, and you'll reconcile & close it from the details view once spend is in.
                </p>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Payment Mode</label>
                  <select
                    value={approvePaymentMode}
                    onChange={e => setApprovePaymentMode(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Select Mode</option>
                    {PAYMENT_MODES.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    {approvePaymentMode === 'UPI' ? 'UPI Transaction ID' : approvePaymentMode === 'Cheque' ? 'Cheque Number' : 'Reference No.'}
                  </label>
                  <input
                    type="text"
                    value={approvePaymentReference}
                    onChange={e => setApprovePaymentReference(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm focus:ring-2 focus:ring-blue-500"
                    placeholder={approvePaymentMode === 'UPI' ? 'e.g., 234567891234' : approvePaymentMode === 'Cheque' ? 'e.g., 000123' : 'Optional'}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <Paperclip size={14} /> Proof of Payment
                </label>
                <input
                  type="file"
                  accept="image/*,.pdf"
                  onChange={e => handleApproveAttachmentChange(e.target.files?.[0] || null)}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm file:mr-3 file:py-1 file:px-3 file:rounded-md file:border-0 file:bg-blue-50 file:text-blue-700 dark:file:bg-blue-900/30 dark:file:text-blue-400"
                />
                {approveAttachmentFilename && <p className="text-xs text-green-600 dark:text-green-400">Attached: {approveAttachmentFilename}</p>}
              </div>
              {approveError && (
                <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
                  {approveError}
                </div>
              )}
              <p className="text-xs text-slate-500">
                {approveSettlementType === 'Payroll'
                  ? 'Approving will disburse the advance and begin recovering it from payroll from the next cycle.'
                  : 'Approving will disburse the advance; the employee logs receipts against it and you reconcile & close it later.'}
              </p>
            </div>
            <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex justify-end gap-3">
              <button onClick={() => setApprovingAdv(null)} className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors">Cancel</button>
              <button onClick={handleApproveConfirm} disabled={approveSubmitting} className="px-4 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 disabled:opacity-50 rounded-lg transition-colors">
                {approveSubmitting ? 'Approving...' : 'Approve & Disburse'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reject Modal */}
      {rejectingAdv && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xl w-full max-w-md overflow-hidden border border-slate-200 dark:border-slate-700">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800">
              <h2 className="text-lg font-bold text-slate-800 dark:text-white">Reject Advance Request</h2>
            </div>
            <div className="p-6 space-y-4 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">Employee</span><span className="font-medium text-slate-900 dark:text-white">{rejectingAdv.employee_name}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Amount</span><span className="font-medium text-slate-900 dark:text-white">₹{Number(rejectingAdv.amount).toLocaleString()}</span></div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Reason for rejection</label>
                <textarea
                  rows={3}
                  value={rejectReason}
                  onChange={e => setRejectReason(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm focus:ring-2 focus:ring-blue-500"
                  placeholder="Let the employee know why this was rejected..."
                />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex justify-end gap-3">
              <button onClick={() => { setRejectingAdv(null); setRejectReason(''); }} className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors">Cancel</button>
              <button onClick={handleRejectConfirm} disabled={rejectSubmitting} className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded-lg transition-colors">
                {rejectSubmitting ? 'Rejecting...' : 'Reject Request'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manual Close / Write-off Modal */}
      {closingAdv && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xl w-full max-w-md overflow-hidden border border-slate-200 dark:border-slate-700">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800">
              <h2 className="text-lg font-bold text-slate-800 dark:text-white">Close Advance</h2>
            </div>
            <div className="p-6 space-y-4 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">Employee</span><span className="font-medium text-slate-900 dark:text-white">{closingAdv.employee_name}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Remaining Balance</span><span className="font-medium text-red-600 dark:text-red-400">₹{Number(closingAdv.balance).toLocaleString()}</span></div>
              <div className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
                This marks the advance Closed and writes off the remaining balance — it will no longer be deducted from any future payroll. This can't be undone from here.
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Reason (required)</label>
                <textarea
                  rows={3}
                  value={closeReason}
                  onChange={e => setCloseReason(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g. Fully recovered outside payroll, employee exited, balance waived..."
                />
              </div>
              {closeError && <p className="text-xs text-red-600 dark:text-red-400">{closeError}</p>}
            </div>
            <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex justify-end gap-3">
              <button onClick={() => { setClosingAdv(null); setCloseReason(''); setCloseError(''); }} className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors">Cancel</button>
              <button onClick={handleCloseConfirm} disabled={closeSubmitting} className="px-4 py-2 text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50 rounded-lg transition-colors">
                {closeSubmitting ? 'Closing...' : 'Close Advance'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Details / Timeline Drawer */}
      {detailsAdv && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xl w-full max-w-lg overflow-hidden border border-slate-200 dark:border-slate-700 max-h-[85vh] flex flex-col">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center">
              <div>
                <h2 className="text-lg font-bold text-slate-800 dark:text-white">{detailsAdv.employee_name}</h2>
                <p className="text-xs text-slate-500">{detailsAdv.advance_type || 'Salary Advance'} · ₹{Number(detailsAdv.amount).toLocaleString()}</p>
              </div>
              <button onClick={() => setDetailsAdv(null)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-6 overflow-y-auto">
              <div>
                <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">
                  <History size={14} /> Request Timeline
                </h3>
                <div className="space-y-3 text-sm">
                  <div className="flex gap-3">
                    <div className="w-2 h-2 mt-1.5 rounded-full bg-teal-500 shrink-0"></div>
                    <div>
                      <div className="text-slate-800 dark:text-slate-200">Raised on {format(new Date(detailsAdv.date), 'MMM dd, yyyy')} via {detailsAdv.request_source === 'Employee Request' ? 'employee self-service request' : 'admin direct entry'}</div>
                    </div>
                  </div>
                  {detailsAdv.status === 'Active' || detailsAdv.status === 'Closed' ? (
                    <div className="flex gap-3">
                      <div className="w-2 h-2 mt-1.5 rounded-full bg-green-500 shrink-0"></div>
                      <div className="text-slate-800 dark:text-slate-200">
                        Approved{detailsAdv.approved_by ? ` by ${detailsAdv.approved_by}` : ''}{detailsAdv.approved_at ? ` on ${format(new Date(detailsAdv.approved_at), 'MMM dd, yyyy')}` : ''}
                      </div>
                    </div>
                  ) : null}
                  {detailsAdv.status === 'Rejected' ? (
                    <div className="flex gap-3">
                      <div className="w-2 h-2 mt-1.5 rounded-full bg-red-500 shrink-0"></div>
                      <div className="text-slate-800 dark:text-slate-200">
                        Rejected{detailsAdv.rejected_by ? ` by ${detailsAdv.rejected_by}` : ''}{detailsAdv.rejected_at ? ` on ${format(new Date(detailsAdv.rejected_at), 'MMM dd, yyyy')}` : ''}
                        {detailsAdv.rejection_reason ? <div className="text-xs text-slate-500 mt-0.5">Reason: {detailsAdv.rejection_reason}</div> : null}
                      </div>
                    </div>
                  ) : null}
                  {detailsAdv.status === 'Pending Approval' ? (
                    <div className="flex gap-3">
                      <div className="w-2 h-2 mt-1.5 rounded-full bg-amber-500 shrink-0"></div>
                      <div className="text-slate-800 dark:text-slate-200">Awaiting approval</div>
                    </div>
                  ) : null}
                  {detailsAdv.status === 'Closed' ? (
                    <div className="flex gap-3">
                      <div className="w-2 h-2 mt-1.5 rounded-full bg-slate-400 shrink-0"></div>
                      <div className="text-slate-800 dark:text-slate-200">Fully recovered — advance closed</div>
                    </div>
                  ) : null}
                </div>
              </div>

              {(detailsAdv.status === 'Active' || detailsAdv.status === 'Closed') && (detailsAdv.settlement_type !== 'Reconciliation') && (
                <div>
                  <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">Repayment Schedule</h3>
                  <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 dark:bg-slate-800/80 text-slate-500 dark:text-slate-400 uppercase">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium">#</th>
                          <th className="px-3 py-2 text-left font-medium">Due Date</th>
                          <th className="px-3 py-2 text-right font-medium">Amount</th>
                          <th className="px-3 py-2 text-right font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                        {buildSchedule(detailsAdv).map(row => (
                          <tr key={row.index}>
                            <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{row.index}</td>
                            <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{format(row.dueDate, 'MMM yyyy')}</td>
                            <td className="px-3 py-2 text-right text-slate-700 dark:text-slate-300">₹{Math.round(row.amount).toLocaleString()}</td>
                            <td className="px-3 py-2 text-right">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${row.status === 'Paid' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'}`}>
                                {row.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {detailsAdv.status === 'Active' && (
                    <button
                      onClick={() => openCloseModal(detailsAdv)}
                      className="w-full mt-3 py-2 text-sm font-medium text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 hover:bg-amber-100 dark:hover:bg-amber-900/30 rounded-lg transition-colors"
                    >
                      Close Advance (Write Off Balance)
                    </button>
                  )}

                  {detailsAdv.status === 'Closed' && detailsAdv.shortfall_action === 'Written Off' && (
                    <div className="mt-3 text-sm border border-amber-200 dark:border-amber-800 rounded-lg divide-y divide-amber-200 dark:divide-amber-800 bg-amber-50/50 dark:bg-amber-900/10">
                      <div className="flex justify-between px-4 py-2.5"><span className="text-slate-500">Closed As</span><span className="font-medium text-amber-700 dark:text-amber-400">Written Off (Manual)</span></div>
                      {detailsAdv.shortfall_notes && <div className="flex justify-between px-4 py-2.5"><span className="text-slate-500">Reason</span><span className="font-medium text-slate-800 dark:text-slate-200 text-right">{detailsAdv.shortfall_notes}</span></div>}
                      {detailsAdv.closed_at && <div className="flex justify-between px-4 py-2.5"><span className="text-slate-500">Closed</span><span className="font-medium text-slate-800 dark:text-slate-200">{format(new Date(detailsAdv.closed_at), 'MMM dd, yyyy')}{detailsAdv.closed_by ? ` by ${detailsAdv.closed_by}` : ''}</span></div>}
                    </div>
                  )}
                </div>
              )}

              {(detailsAdv.status === 'Active' || detailsAdv.status === 'Closed') && (
                <div>
                  <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">Disbursement / Reconciliation</h3>
                  <div className="border border-slate-200 dark:border-slate-700 rounded-lg divide-y divide-slate-200 dark:divide-slate-700 text-sm">
                    <div className="flex justify-between px-4 py-2.5"><span className="text-slate-500">Expense Category</span><span className="font-medium text-slate-800 dark:text-slate-200">{detailsAdv.expense_category || '—'} Expense</span></div>
                    <div className="flex justify-between px-4 py-2.5"><span className="text-slate-500">Payment Mode</span><span className="font-medium text-slate-800 dark:text-slate-200">{detailsAdv.payment_mode || '—'}</span></div>
                    <div className="flex justify-between px-4 py-2.5"><span className="text-slate-500">Reference No.</span><span className="font-medium text-slate-800 dark:text-slate-200">{detailsAdv.payment_reference || '—'}</span></div>
                    <div className="flex justify-between items-center px-4 py-2.5">
                      <span className="text-slate-500">Proof of Payment</span>
                      {detailsAdv.has_attachment ? (
                        <button
                          onClick={() => downloadAttachment(detailsAdv.id)}
                          className="flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline font-medium"
                        >
                          <Download size={14} /> Download
                        </button>
                      ) : (
                        <span className="text-amber-600 dark:text-amber-400 font-medium">Not attached</span>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {(detailsAdv.settlement_type === 'Reconciliation') && (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Expense Line Items</h3>
                    {detailsAdv.status === 'Active' && (
                      <span className="text-xs text-slate-500">
                        ₹{(Number(detailsAdv.reconciled_amount) || 0).toLocaleString()} logged of ₹{Number(detailsAdv.amount).toLocaleString()}
                      </span>
                    )}
                  </div>

                  <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden mb-3">
                    {itemsLoading ? (
                      <div className="px-4 py-6 text-center text-sm text-slate-400">Loading...</div>
                    ) : expenseItems.length === 0 ? (
                      <div className="px-4 py-6 text-center text-sm text-slate-400">No expense items logged yet</div>
                    ) : (
                      <table className="w-full text-xs">
                        <thead className="bg-slate-50 dark:bg-slate-800/80 text-slate-500 dark:text-slate-400 uppercase">
                          <tr>
                            <th className="px-3 py-2 text-left font-medium">Date</th>
                            <th className="px-3 py-2 text-left font-medium">Category</th>
                            <th className="px-3 py-2 text-left font-medium">Description</th>
                            <th className="px-3 py-2 text-right font-medium">Amount</th>
                            <th className="px-3 py-2 text-right font-medium">Receipt</th>
                            {detailsAdv.status === 'Active' && <th className="px-3 py-2 text-right font-medium"></th>}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                          {expenseItems.map(item => (
                            <tr key={item.id}>
                              <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{format(new Date(item.date), 'MMM dd')}</td>
                              <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{item.category}</td>
                              <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{item.description || '—'}</td>
                              <td className="px-3 py-2 text-right text-slate-700 dark:text-slate-300">₹{Number(item.amount).toLocaleString()}</td>
                              <td className="px-3 py-2 text-right">
                                {item.has_receipt ? (
                                  <button onClick={() => downloadReceipt(detailsAdv.id, item.id, item.receipt_filename)} className="text-blue-600 dark:text-blue-400 hover:underline">
                                    <Download size={12} className="inline" />
                                  </button>
                                ) : <span className="text-slate-300">—</span>}
                              </td>
                              {detailsAdv.status === 'Active' && (
                                <td className="px-3 py-2 text-right">
                                  <button onClick={() => handleDeleteExpenseItem(item.id, Number(item.amount))} className="text-red-500 hover:text-red-700">
                                    <Trash2 size={12} />
                                  </button>
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>

                  {detailsAdv.status === 'Active' && (
                    <>
                      <div className="grid grid-cols-2 gap-3 mb-2">
                        <input type="date" value={itemForm.date} onChange={e => setItemForm({ ...itemForm, date: e.target.value })}
                          className="px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm" />
                        <select value={itemForm.category} onChange={e => setItemForm({ ...itemForm, category: e.target.value })}
                          className="px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm">
                          {EXPENSE_ITEM_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                        <input type="text" placeholder="Description" value={itemForm.description} onChange={e => setItemForm({ ...itemForm, description: e.target.value })}
                          className="px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm col-span-2" />
                        <input type="number" placeholder="Amount" value={itemForm.amount} onChange={e => setItemForm({ ...itemForm, amount: e.target.value })}
                          className="px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm" />
                        <input type="file" accept="image/*,.pdf" onChange={e => handleItemReceiptChange(e.target.files?.[0] || null)}
                          className="px-2 py-1.5 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-xs file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:bg-blue-50 file:text-blue-700 dark:file:bg-blue-900/30 dark:file:text-blue-400" />
                      </div>
                      {itemError && <p className="text-xs text-red-600 dark:text-red-400 mb-2">{itemError}</p>}
                      <button
                        onClick={handleAddExpenseItem}
                        disabled={itemSubmitting}
                        className="w-full py-2 text-sm font-medium text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/30 rounded-lg transition-colors disabled:opacity-50"
                      >
                        {itemSubmitting ? 'Adding...' : '+ Add Expense Item'}
                      </button>

                      <button
                        onClick={() => setShowReconcileModal(true)}
                        className="w-full mt-3 py-2 text-sm font-medium text-white bg-slate-800 dark:bg-slate-700 hover:bg-slate-900 dark:hover:bg-slate-600 rounded-lg transition-colors"
                      >
                        Reconcile & Close
                      </button>
                    </>
                  )}

                  {detailsAdv.status === 'Closed' && detailsAdv.shortfall_action && (
                    <div className="mt-3 text-sm border border-slate-200 dark:border-slate-700 rounded-lg divide-y divide-slate-200 dark:divide-slate-700">
                      <div className="flex justify-between px-4 py-2.5"><span className="text-slate-500">Settled As</span><span className="font-medium text-slate-800 dark:text-slate-200">{detailsAdv.shortfall_action}</span></div>
                      {detailsAdv.shortfall_reference && <div className="flex justify-between px-4 py-2.5"><span className="text-slate-500">Reference</span><span className="font-medium text-slate-800 dark:text-slate-200">{detailsAdv.shortfall_reference}</span></div>}
                      {detailsAdv.closed_at && <div className="flex justify-between px-4 py-2.5"><span className="text-slate-500">Closed</span><span className="font-medium text-slate-800 dark:text-slate-200">{format(new Date(detailsAdv.closed_at), 'MMM dd, yyyy')}{detailsAdv.closed_by ? ` by ${detailsAdv.closed_by}` : ''}</span></div>}
                    </div>
                  )}
                </div>
              )}

              {detailsAdv.remarks && (
                <div>
                  <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">Remarks</h3>
                  <p className="text-sm text-slate-600 dark:text-slate-400">{detailsAdv.remarks}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showReconcileModal && detailsAdv && (
        <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xl w-full max-w-md border border-slate-200 dark:border-slate-700 max-h-[90vh] overflow-y-auto my-8">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800">
              <h2 className="text-lg font-bold text-slate-800 dark:text-white">Reconcile & Close</h2>
            </div>
            <div className="p-6 space-y-4 text-sm">
              <div className="border border-slate-200 dark:border-slate-700 rounded-lg divide-y divide-slate-200 dark:divide-slate-700">
                <div className="flex justify-between px-4 py-2.5"><span className="text-slate-500">Advance Amount</span><span className="font-medium text-slate-800 dark:text-slate-200">₹{Number(detailsAdv.amount).toLocaleString()}</span></div>
                <div className="flex justify-between px-4 py-2.5"><span className="text-slate-500">Logged Spend</span><span className="font-medium text-slate-800 dark:text-slate-200">₹{(Number(detailsAdv.reconciled_amount) || 0).toLocaleString()}</span></div>
                <div className="flex justify-between px-4 py-2.5">
                  <span className="text-slate-500">{reconciliationGap() >= 0 ? 'Balance owed by employee' : 'Excess owed to employee'}</span>
                  <span className={`font-semibold ${reconciliationGap() >= 0 ? 'text-amber-600 dark:text-amber-400' : 'text-blue-600 dark:text-blue-400'}`}>
                    ₹{Math.abs(reconciliationGap()).toLocaleString()}
                  </span>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Settle As</label>
                <select
                  value={reconcileAction}
                  onChange={e => setReconcileAction(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select</option>
                  {reconciliationGap() > 0.01 && <option value="Refunded">Refunded — employee returned the balance</option>}
                  {reconciliationGap() > 0.01 && <option value="Carried Forward">Carried Forward — roll balance into a new advance</option>}
                  {reconciliationGap() < -0.01 && <option value="Reimbursed">Reimbursed — company pays employee the excess</option>}
                  {Math.abs(reconciliationGap()) <= 0.01 && <option value="Settled">Settled — spend matches the advance exactly</option>}
                </select>
              </div>

              {(reconcileAction === 'Refunded' || reconcileAction === 'Reimbursed') && (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Reference No. (UPI / Cheque / UTR)</label>
                  <input
                    type="text"
                    value={reconcileReference}
                    onChange={e => setReconcileReference(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm focus:ring-2 focus:ring-blue-500"
                    placeholder="Optional"
                  />
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Notes</label>
                <textarea
                  rows={2}
                  value={reconcileNotes}
                  onChange={e => setReconcileNotes(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm focus:ring-2 focus:ring-blue-500"
                  placeholder="Any additional details..."
                />
              </div>

              {reconcileError && (
                <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
                  {reconcileError}
                </div>
              )}
            </div>
            <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex justify-end gap-3">
              <button onClick={() => setShowReconcileModal(false)} className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors">Cancel</button>
              <button onClick={handleReconcileConfirm} disabled={reconcileSubmitting || !reconcileAction} className="px-4 py-2 text-sm font-medium text-white bg-slate-800 dark:bg-slate-700 hover:bg-slate-900 disabled:opacity-50 rounded-lg transition-colors">
                {reconcileSubmitting ? 'Closing...' : 'Confirm & Close Advance'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, subValue, icon, color }: { label: string, value: string, subValue: string, icon: React.ReactNode, color: 'blue' | 'green' | 'orange' | 'purple' | 'amber' }) {
  const colorStyles = {
    blue: 'bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400 border-blue-100 dark:border-blue-900/30',
    green: 'bg-green-50 text-green-600 dark:bg-green-900/20 dark:text-green-400 border-green-100 dark:border-green-900/30',
    orange: 'bg-orange-50 text-orange-600 dark:bg-orange-900/20 dark:text-orange-400 border-orange-100 dark:border-orange-900/30',
    purple: 'bg-purple-50 text-purple-600 dark:bg-purple-900/20 dark:text-purple-400 border-purple-100 dark:border-purple-900/30',
    amber: 'bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400 border-amber-100 dark:border-amber-900/30',
  };

  return (
    <div className={`p-4 rounded-xl border ${colorStyles[color]} flex flex-col gap-3`}>
      <div className="flex items-center gap-2 text-sm font-medium opacity-80">
        {icon}
        {label}
      </div>
      <div>
        <div className="text-2xl font-bold text-slate-900 dark:text-white">{value}</div>
        <div className="text-xs mt-1 opacity-70">{subValue}</div>
      </div>
    </div>
  );
}