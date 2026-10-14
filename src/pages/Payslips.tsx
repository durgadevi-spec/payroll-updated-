import { useState, useEffect } from 'react';
import { FileText, Eye, Download, Send, X, Trash2, Plus, Layout, Pencil, Save, Maximize2, Minimize2, ImagePlus } from 'lucide-react';
import html2pdf from 'html2pdf.js';
import { supabase } from '../lib/supabase';
import { useToast } from '../context/ToastContext';
import { getMonthName } from '../lib/payrollCalculator';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Modal } from '../components/ui/Modal';
import { Badge } from '../components/ui/Badge';
import { TableSkeleton } from '../components/ui/Skeleton';
import { PayslipTemplateEditor } from '../components/payslips/PayslipTemplateEditor';
import { PayslipDocument } from '../components/payslips/PayslipDocument';
import { PayslipTemplate, PayslipTemplateContent } from '../types/payslip';
import { PayslipFull } from '../types';

export function Payslips() {
  const { showToast } = useToast();
  const [payslips, setPayslips] = useState<PayslipFull[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewPayslip, setViewPayslip] = useState<PayslipFull | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sendingEmail, setSendingEmail] = useState(false);
  const [templates, setTemplates] = useState<PayslipTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<PayslipTemplate | null>(null);
  const [sendTemplate, setSendTemplate] = useState<PayslipTemplate | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [editorMode, setEditorMode] = useState<'structured' | 'visual'>('structured');
  const [showSendConfirm, setShowSendConfirm] = useState(false);
  const [sendType, setSendType] = useState<'selected' | 'all'>('selected');
  const [previewPayslip, setPreviewPayslip] = useState<PayslipFull | null>(null);
  // Send dialog: payslips being sent, inline-edit draft state
  const [sendIds, setSendIds] = useState<string[]>([]);
  const [inlineEditing, setInlineEditing] = useState(false);
  const [draftContent, setDraftContent] = useState<PayslipTemplateContent | null>(null);
  const [itemChanges, setItemChanges] = useState<Record<string, any>>({});
  const [empChanges, setEmpChanges] = useState<Record<string, string>>({});
  const itemDirty = Object.keys(itemChanges).length > 0 || Object.keys(empChanges).length > 0;
  const [labelsDirty, setLabelsDirty] = useState(false); // template content (labels + header) edited
  const [savingEdits, setSavingEdits] = useState(false);
  const [sendFullscreen, setSendFullscreen] = useState(false);
  const dirty = itemDirty || labelsDirty;

  useEffect(() => {
    loadPayslips();
    loadTemplates();
  }, []);

  useEffect(() => {
    // Fresh editable copy of the send template whenever the dialog opens or its template changes
    setDraftContent(sendTemplate?.content ? JSON.parse(JSON.stringify(sendTemplate.content)) : null);
    setLabelsDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sendTemplate?.id, sendTemplate?.content, showSendConfirm]);

  async function loadTemplates() {
    const { data, error } = await supabase
      .from('payslip_templates')
      .select('*')
      .order('created_at', { ascending: false });

    if (!error && data) {
      setTemplates(data);
      if (data.length > 0 && !selectedTemplate) {
        setSelectedTemplate(data[0]);
      } else if (selectedTemplate?.id) {
        // Refresh the selected template from the DB so edits made in the Template Designer
        // are not lost (stale content would otherwise be written back on the next save).
        const fresh = data.find((t: PayslipTemplate) => t.id === selectedTemplate.id);
        if (fresh) setSelectedTemplate(fresh);
      }
      if (sendTemplate?.id) {
        const fresh = data.find((t: PayslipTemplate) => t.id === sendTemplate.id);
        if (fresh) setSendTemplate(fresh);
      }
    }
  }

  function resetEditDrafts() {
    setItemChanges({});
    setEmpChanges({});
    setLabelsDirty(false);
    setDraftContent(sendTemplate?.content ? JSON.parse(JSON.stringify(sendTemplate.content)) : null);
  }

  async function loadSendPreview(payslipId: string) {
    const ps = payslips.find(p => p.id === payslipId);
    setPreviewPayslip(null);
    setItemChanges({});
    setEmpChanges({});
    if (!ps) return;
    const { data } = await supabase
      .from('payroll_items')
      .select('*')
      .eq('payroll_id', ps.payroll_id)
      .eq('employee_id', ps.employee_id)
      .maybeSingle();
    if (data) setPreviewPayslip({ ...ps, payroll_item: data });
  }

  async function prepareSendPreview(type: 'selected' | 'all', ids?: Set<string>) {
    setSendTemplate(null);
    setSendType(type);
    setSendFullscreen(false);
    setInlineEditing(false);
    setItemChanges({});
    setEmpChanges({});
    setLabelsDirty(false);

    let list: string[] = [];
    if (type === 'all') list = payslips.filter(ps => !ps.email_sent).map(ps => ps.id);
    else if (ids && ids.size > 0) list = Array.from(ids);
    else list = Array.from(selectedIds);
    setSendIds(list);

    if (list.length > 0) await loadSendPreview(list[0]);
    else setPreviewPayslip(null);
    setShowSendConfirm(true);
  }

  async function changePreviewRecipient(payslipId: string) {
    if (dirty && !confirm('You have unsaved edits. Discard them and switch payslip?')) return;
    if (dirty) resetEditDrafts();
    await loadSendPreview(payslipId);
  }

  // Maps a payslip row key to the payroll_items column it edits
  const COLUMN_FOR_KEY: Record<string, string> = {
    monthly_salary: 'monthly_salary', bonus: 'bonus', previous_month_balance: 'previous_month_balance',
    hra: 'hra', conveyance: 'conveyance', medical: 'medical', ot_allowance: 'ot_allowance',
    lop: 'leave_deduction', leave_deduction: 'leave_deduction',
    pf: 'pf_deduction', pf_deduction: 'pf_deduction',
    esi: 'esi_deduction', esi_deduction: 'esi_deduction',
    tax: 'tax_deduction', tax_deduction: 'tax_deduction',
    loan: 'loan_deduction', loan_deduction: 'loan_deduction',
    advance: 'advance_deduction', advance_deduction: 'advance_deduction',
    working_days: 'working_days', calculation_days: 'calculation_days',
  };
  const EARNING_COLUMNS = ['monthly_salary', 'bonus', 'previous_month_balance', 'ot_allowance'];
  const DEDUCTION_COLUMNS = ['leave_deduction', 'pf_deduction', 'esi_deduction', 'tax_deduction', 'loan_deduction', 'advance_deduction'];

  // Inline amount edit: updates the draft only. Net salary is adjusted by the change so existing
  // components (Sunday earnings, previous balance, etc.) are preserved. Day counts don't affect net.
  function handleInlineValue(key: string, val: number) {
    if (!previewPayslip?.payroll_item) return;
    const item: any = previewPayslip.payroll_item;

    // Sunday Work Earnings is calculated (salary / days x Sunday work days). Convert the typed amount back
    // to Sunday work days, which is what gets saved, and move net salary by the change in earnings.
    if (key === 'sunday_work_earnings') {
      const perDay = Number(item.monthly_salary || 0) / Number(item.working_days || 30);
      if (!perDay) return;
      const days = Math.round((Math.max(0, val) / perDay) * 10000) / 10000;
      const oldEarn = Math.round(perDay * Number(item.sunday_work_days || 0) * 100) / 100;
      const newEarn = Math.round(perDay * days * 100) / 100;
      const net = Math.round((Number(item.net_salary || 0) + (newEarn - oldEarn)) * 100) / 100;
      setPreviewPayslip({ ...previewPayslip, payroll_item: { ...item, sunday_work_days: days, net_salary: net } });
      setItemChanges(prev => ({ ...prev, sunday_work_days: days }));
      return;
    }

    const col = COLUMN_FOR_KEY[key];
    if (!col) return;
    let newVal = val;
    // "LOP" row shows leave + timesheet deduction combined; edit the leave part
    if (col === 'leave_deduction') newVal = Math.max(0, val - (item.timesheet_deduction || 0));
    const oldVal = Number(item[col] || 0);
    const delta = newVal - oldVal;
    let net = Number(item.net_salary || 0);
    if (EARNING_COLUMNS.includes(col)) net += delta;
    else if (DEDUCTION_COLUMNS.includes(col)) net -= delta;
    net = Math.round(net * 100) / 100;
    setPreviewPayslip({ ...previewPayslip, payroll_item: { ...item, [col]: newVal, net_salary: net } });
    setItemChanges(prev => ({ ...prev, [col]: newVal }));
  }

  // Leave Balances table edits are stored as JSON on the payroll item (does not affect net salary)
  function handleInlineLeaveBalances(rows: any[]) {
    if (!previewPayslip?.payroll_item) return;
    setPreviewPayslip({ ...previewPayslip, payroll_item: { ...(previewPayslip.payroll_item as any), leave_balances: rows } });
    setItemChanges(prev => ({ ...prev, leave_balances: rows }));
  }

  function handleInlineEmployee(field: 'name' | 'designation' | 'department' | 'bank_account', value: string) {
    if (!previewPayslip) return;
    setPreviewPayslip({ ...previewPayslip, employee: { ...previewPayslip.employee, [field]: value } });
    setEmpChanges(prev => ({ ...prev, [field]: value }));
  }

  function handleInlineLabel(section: 'earnings' | 'deductions', index: number, label: string) {
    if (!draftContent) return;
    const next = JSON.parse(JSON.stringify(draftContent)) as PayslipTemplateContent;
    next.sections[section].rows[index].label = label;
    setDraftContent(next);
    setLabelsDirty(true);
  }

  function handleInlineHeader(field: 'title' | 'address', value: string) {
    if (!draftContent) return;
    setDraftContent({ ...draftContent, header: { ...draftContent.header, [field]: value } });
    setLabelsDirty(true);
  }

  // Persists inline edits: amounts -> payroll_items, employee details -> employees,
  // labels/header -> selected template. Every write is verified (0 rows updated = failure).
  async function saveInlineEdits(): Promise<boolean> {
    if (!dirty) return true;
    setSavingEdits(true);
    try {
      const it: any = previewPayslip?.payroll_item;

      if (Object.keys(itemChanges).length > 0 && it) {
        const { data, error } = await supabase
          .from('payroll_items')
          .update({ ...itemChanges, net_salary: it.net_salary })
          .eq('id', it.id)
          .select('id');
        if (error) throw new Error(`Payroll data: ${error.message}`);
        if (!data || data.length === 0) throw new Error('Payroll data was not updated (record not found or not permitted)');
        setItemChanges({});
      }

      if (Object.keys(empChanges).length > 0 && previewPayslip) {
        const { data, error } = await supabase
          .from('employees')
          .update(empChanges)
          .eq('id', previewPayslip.employee_id)
          .select('id');
        if (error) throw new Error(`Employee details: ${error.message}`);
        if (!data || data.length === 0) throw new Error('Employee details were not updated (record not found or not permitted)');
        const changes = empChanges;
        setPayslips(prev => prev.map(p => (p.employee_id === previewPayslip.employee_id ? { ...p, employee: { ...p.employee, ...changes } } : p)));
        setEmpChanges({});
      }

      if (labelsDirty && sendTemplate?.id && draftContent) {
        const { data, error } = await supabase
          .from('payslip_templates')
          .update({ content: draftContent, updated_at: new Date().toISOString() })
          .eq('id', sendTemplate.id)
          .select('id');
        if (error) throw new Error(`Template: ${error.message}`);
        if (!data || data.length === 0) throw new Error('Template was not updated (record not found or not permitted)');
        const updated = { ...sendTemplate, content: draftContent };
        setSendTemplate(updated);
        if (selectedTemplate?.id === updated.id) setSelectedTemplate(updated);
        setTemplates(prev => prev.map(t => (t.id === updated.id ? updated : t)));
        setLabelsDirty(false);
      }

      showToast('success', 'Changes saved');
      return true;
    } catch (err) {
      console.error('Save payslip edits error:', err);
      showToast('error', `Failed to save: ${(err as Error).message}`);
      return false;
    } finally {
      setSavingEdits(false);
    }
  }

  async function deleteTemplate(id: string) {
    if (!confirm('Are you sure you want to delete this template?')) return;

    const { data, error } = await supabase.from('payslip_templates').delete().eq('id', id).select('id');
    if (!error && data && data.length > 0) {
      showToast('success', 'Template deleted successfully');
      if (selectedTemplate?.id === id) setSelectedTemplate(null);
      if (sendTemplate?.id === id) setSendTemplate(null);
      setTemplates(prev => prev.filter(t => t.id !== id));
      loadTemplates();
    } else {
      showToast('error', error ? `Failed to delete template: ${error.message}` : 'Template was not deleted (not found or not permitted)');
    }
  }

  async function loadPayslips() {
    setLoading(true);
    const { data, error } = await supabase
      .from('payslips')
      .select(`*, employee:employees(id,employee_code,joining_date,name,email,designation,department,site_location,bank_name,bank_account,pan_number,pf_number,uan_number), payroll:payrolls(id,month,year,status)`)
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

  async function sendEmails(idsParam?: Set<string>) {
    if (!idsParam && selectedIds.size === 0) return;
    setSendingEmail(true);

    try {
      const ids = idsParam ? Array.from(idsParam) : Array.from(selectedIds);
      const response = await fetch('/api/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payslipIds: ids,
          templateId: sendTemplate?.id
        }),
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
        body: JSON.stringify({
          payslipIds: pendingPayslipIds,
          templateId: sendTemplate?.id
        }),
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

  function downloadPayslipPDF(payslip: PayslipFull) {
    const element = document.getElementById('payslip-content');
    if (!element) {
      showToast('error', 'Payslip content not found');
      return;
    }

    // Create a clone to avoid modifying the original
    const clonedElement = element.cloneNode(true) as HTMLElement;

    // Image templates are a full page: capture at the image's exact shape with no margin
    const visualAspect = selectedTemplate?.content?.type === 'visual' && selectedTemplate.content.visualConfig?.backgroundImage
      ? (selectedTemplate.content.visualConfig.aspectRatio || 297 / 210)
      : null;
    const pageH = visualAspect ? 210 * visualAspect : 297;
    const pageFormat: [number, number] = [Math.min(210, pageH), Math.max(210, pageH)];

    // Set up PDF options
    const options = {
      margin: visualAspect ? 0 : 10,
      filename: `Payslip_${payslip.employee.name}_${payslip.payroll.month}_${payslip.payroll.year}.pdf`,
      image: { type: 'jpeg' as const, quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: visualAspect
        ? { orientation: (pageH >= 210 ? 'portrait' : 'landscape') as 'portrait' | 'landscape', unit: 'mm', format: pageFormat }
        : { orientation: 'portrait' as const, unit: 'mm', format: 'a4' },
      pagebreak: { mode: ['avoid-all', 'css', 'legacy'] },
    };

    try {
      // Generate and download PDF
      html2pdf().set(options).from(clonedElement).save();
      showToast('success', 'Payslip PDF downloaded successfully');
    } catch (error) {
      console.error('PDF generation error:', error);
      showToast('error', 'Failed to generate PDF');
    }
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
          <Button
            variant="outline"
            icon={<Plus size={15} />}
            onClick={() => {
              setSelectedTemplate(null);
              setEditorMode('structured');
              setShowEditor(true);
            }}
          >
            New Template
          </Button>
          <Button
            variant="outline"
            icon={<ImagePlus size={15} />}
            onClick={() => {
              setSelectedTemplate(null);
              setEditorMode('visual');
              setShowEditor(true);
            }}
          >
            New Image Template
          </Button>
          <div className="flex items-center gap-2 px-3 py-1 bg-slate-100 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
            <span className="text-[10px] font-bold text-slate-400 uppercase">Active Template:</span>
            <select
              className="text-xs bg-transparent border-none focus:ring-0 font-semibold text-slate-700 dark:text-slate-200"
              value={selectedTemplate?.id || ''}
              onChange={(e) => {
                const t = templates.find(temp => temp.id === e.target.value);
                setSelectedTemplate(t || null);
              }}
            >
              <option value="">Default Template</option>
              {templates.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            {selectedTemplate && (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setShowEditor(true)}
                  className="p-1 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded transition-colors"
                  title="Edit Template"
                >
                  <Layout size={14} />
                </button>
                <button
                  onClick={() => deleteTemplate(selectedTemplate.id!)}
                  className="p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded transition-colors"
                  title="Delete Template"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            )}
          </div>
          {pendingEmailCount > 0 && (
            <Button
              icon={<Send size={15} />}
              loading={sendingEmail}
              onClick={() => prepareSendPreview('all')}
            >
              Send {pendingEmailCount} Pending Payslip{pendingEmailCount > 1 ? 's' : ''}
            </Button>
          )}
          {selectedIds.size > 0 && (
            <Button
              icon={<Send size={15} />}
              loading={sendingEmail}
              onClick={() => prepareSendPreview('selected')}
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
                          onClick={() => prepareSendPreview('selected', new Set([ps.id]))}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors"
                          title="Send via Email"
                          disabled={sendingEmail}
                        >
                          <Send size={14} />
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
        size="xl"
        footer={
          <div className="flex justify-between items-center w-full">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">Template:</span>
              <select
                className="text-xs border rounded p-1 bg-white dark:bg-slate-800 dark:border-slate-700"
                value={selectedTemplate?.id || ''}
                onChange={(e) => {
                  const t = templates.find(temp => temp.id === e.target.value);
                  setSelectedTemplate(t || null);
                }}
              >
                <option value="">Default Template</option>
                {templates.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              <div className="flex items-center">
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Layout size={12} />}
                  onClick={() => setShowEditor(true)}
                  title="Edit Template Layout"
                >
                  <span className="sr-only">Edit Template Layout</span>
                </Button>
                {selectedTemplate && (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Trash2 size={12} />}
                    onClick={() => deleteTemplate(selectedTemplate.id!)}
                    title="Delete Template"
                    className="text-red-500 hover:text-red-600 hover:bg-red-50"
                  >
                    <span className="sr-only">Delete Template</span>
                  </Button>
                )}
              </div>
              <Button size="sm" variant="ghost" icon={<Plus size={12} />} onClick={() => {
                setSelectedTemplate(null);
                setEditorMode('structured');
                setShowEditor(true);
              }}>New</Button>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setViewPayslip(null)}>Close</Button>
              <Button icon={<Download size={14} />} onClick={() => { if (viewPayslip) downloadPayslipPDF(viewPayslip); }}>Download PDF</Button>
            </div>
          </div>
        }
      >
        {viewPayslip && (
          <div className="space-y-4">
            <div className="flex items-center justify-between px-1">
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-widest">Live View & Edit Mode</span>
              <p className="text-[10px] italic text-blue-600 dark:text-blue-400">Click on values to edit them directly</p>
            </div>
            <div className="border rounded-lg bg-white overflow-hidden shadow-sm">
              <PayslipDocument
                domId="payslip-content"
                payslip={viewPayslip}
                templateContent={selectedTemplate?.content}
                editable={true}
                onUpdateLabel={async (section, index, newLabel) => {
                  if (!selectedTemplate) return;
                  const newContent = { ...selectedTemplate.content };
                  newContent.sections[section].rows[index].label = newLabel;

                  // Update locally
                  const updatedTemplate = { ...selectedTemplate, content: newContent };
                  setSelectedTemplate(updatedTemplate);
                  setTemplates(prev => prev.map(t => t.id === updatedTemplate.id ? updatedTemplate : t));

                  // Save to DB
                  await supabase.from('payslip_templates').update({ content: newContent }).eq('id', selectedTemplate.id);
                }}
                onRemoveRow={async (section, index) => {
                  if (!selectedTemplate) return;
                  if (!confirm('Remove this row from the template?')) return;

                  const newContent = { ...selectedTemplate.content };
                  newContent.sections[section].rows = newContent.sections[section].rows.filter((_, i) => i !== index);

                  // Update locally
                  const updatedTemplate = { ...selectedTemplate, content: newContent };
                  setSelectedTemplate(updatedTemplate);
                  setTemplates(prev => prev.map(t => t.id === updatedTemplate.id ? updatedTemplate : t));

                  // Save to DB
                  await supabase.from('payslip_templates').update({ content: newContent }).eq('id', selectedTemplate.id);
                }}
                onUpdateValue={async (key, val) => {
                  if (!viewPayslip.payroll_item) return;
                  const newItem = { ...viewPayslip.payroll_item, [key]: val };

                  // Recalculate net salary locally for the preview
                  const basic = newItem.monthly_salary || 0;
                  const bonus = newItem.bonus || 0;
                  const leave = newItem.leave_deduction || 0;
                  const pf = newItem.pf_deduction || 0;
                  const esi = newItem.esi_deduction || 0;
                  const tax = newItem.tax_deduction || 0;
                  const advance = newItem.advance_deduction || 0;
                  const loan = newItem.loan_deduction || 0;
                  const timesheet = newItem.timesheet_deduction || 0;

                  newItem.net_salary = basic + bonus - leave - pf - esi - tax - advance - loan - timesheet;

                  setViewPayslip({ ...viewPayslip, payroll_item: newItem });

                  // Save to DB
                  const { error } = await supabase
                    .from('payroll_items')
                    .update({ [key]: val, net_salary: newItem.net_salary })
                    .eq('id', newItem.id);

                  if (error) showToast('error', 'Failed to update value');
                }}
              />
            </div>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={showEditor}
        onClose={() => setShowEditor(false)}
        title="Professional Payslip Template Designer"
        size="full"
      >
        <PayslipTemplateEditor
          initialMode={editorMode}
          initialTemplate={showSendConfirm
            ? sendTemplate ? { id: sendTemplate.id, name: sendTemplate.name, content: sendTemplate.content } : undefined
            : selectedTemplate ? { id: selectedTemplate.id, name: selectedTemplate.name, content: selectedTemplate.content } : undefined}
          onClose={() => setShowEditor(false)}
          onSave={() => {
            setShowEditor(false);
            loadTemplates();
          }}
        />
      </Modal>

      <Modal
        isOpen={showSendConfirm}
        onClose={() => setShowSendConfirm(false)}
        title="Send Payslips"
        size="2xl"
        fullscreen={sendFullscreen}
        footer={
          <div className="flex items-center justify-between gap-2">
            <Button
              variant="ghost"
              icon={sendFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              onClick={() => setSendFullscreen(v => !v)}
            >
              {sendFullscreen ? 'Exit Full Screen' : 'Full Screen'}
            </Button>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowSendConfirm(false)}>Cancel</Button>
              <Button
                loading={sendingEmail || savingEdits}
                disabled={(sendType === 'all' ? pendingEmailCount : sendIds.length) === 0}
                onClick={async () => {
                  // Save any inline edits first so the emailed PDF reflects them
                  if (!(await saveInlineEdits())) return;
                  if (sendType === 'all') await sendAllPendingEmails();
                  else await sendEmails(new Set(sendIds));
                  setInlineEditing(false);
                  setShowSendConfirm(false);
                }}
              >
                Confirm & Send
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-3">
          {/* Single compact toolbar row: count | template | sample/recipient | edit + save */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg text-blue-700 dark:text-blue-300 text-xs">
            <span className="font-semibold whitespace-nowrap">
              Send {sendType === 'all' ? pendingEmailCount : sendIds.length} payslip(s)
            </span>
            <span className="text-slate-300 dark:text-slate-600">|</span>
            <label className="font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap">Template:</label>
            <select
              className="w-44 border rounded-md px-2 py-1 text-xs bg-white dark:bg-slate-800 dark:border-slate-700 text-slate-800 dark:text-slate-100"
              value={sendTemplate?.id || ''}
              onChange={(e) => {
                const t = templates.find(temp => temp.id === e.target.value);
                setSendTemplate(t || null);
              }}
            >
              <option value="">Default Template</option>
              {templates.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            {sendTemplate && (
              <Button
                size="sm"
                variant="ghost"
                icon={<Layout size={12} />}
                onClick={() => setShowEditor(true)}
                className="text-blue-600 whitespace-nowrap"
              >
                Edit Template
              </Button>
            )}
            {sendTemplate?.id && (
              <Button
                size="sm"
                variant="ghost"
                icon={<Trash2 size={12} />}
                onClick={() => deleteTemplate(sendTemplate.id!)}
                className="text-red-500 hover:text-red-600 hover:bg-red-50 whitespace-nowrap"
              >
                Delete
              </Button>
            )}
            {previewPayslip && (
              <>
                <span className="text-slate-300 dark:text-slate-600">|</span>
                <span className="flex items-center gap-1.5 whitespace-nowrap text-slate-600 dark:text-slate-300">
                  <Eye size={12} /> Sample:
                  {sendIds.length > 1 ? (
                    <select
                      className="text-xs border rounded-md px-2 py-1 bg-white dark:bg-slate-800 dark:border-slate-700 max-w-[170px] text-slate-800 dark:text-slate-100"
                      value={previewPayslip.id}
                      onChange={(e) => changePreviewRecipient(e.target.value)}
                    >
                      {sendIds.map(id => {
                        const p = payslips.find(x => x.id === id);
                        return <option key={id} value={id}>{p?.employee?.name || id}</option>;
                      })}
                    </select>
                  ) : (
                    <strong className="uppercase">{previewPayslip.employee?.name}</strong>
                  )}
                </span>
                <div className="flex items-center gap-2 ml-auto">
                  <Button
                    size="sm"
                    variant={inlineEditing ? 'secondary' : 'outline'}
                    icon={<Pencil size={12} />}
                    onClick={() => setInlineEditing(v => !v)}
                  >
                    {inlineEditing ? 'Done Editing' : 'Edit Payslip'}
                  </Button>
                  {dirty && (
                    <Button size="sm" icon={<Save size={12} />} loading={savingEdits} onClick={() => saveInlineEdits()}>
                      Save Changes
                    </Button>
                  )}
                </div>
              </>
            )}
          </div>

          {previewPayslip && (
            <>
              {inlineEditing && (
                <p className="text-[10px] italic text-blue-600 dark:text-blue-400">
                  Amounts, days and employee details save to this employee's record{sendTemplate ? '; company header and row labels save to the selected template (applies to all payslips using it)' : ''}.
                  {dirty ? ' Unsaved changes are saved automatically when you confirm & send.' : ''}
                </p>
              )}
              <div className={`${sendFullscreen ? 'h-[calc(100vh-215px)]' : 'h-[calc(90vh-265px)]'} min-h-[380px] overflow-y-auto border shadow-sm bg-white rounded-lg flex justify-center`}>
                <div className="w-full max-w-[900px]">
                  <PayslipDocument
                    payslip={previewPayslip}
                    templateContent={draftContent || sendTemplate?.content}
                    inlineEdit={inlineEditing}
                    onUpdateValue={handleInlineValue}
                    onUpdateLeaveBalances={handleInlineLeaveBalances}
                    onUpdateEmployee={handleInlineEmployee}
                    onUpdateLabel={draftContent ? handleInlineLabel : undefined}
                    onUpdateHeader={draftContent ? handleInlineHeader : undefined}
                  />
                </div>
              </div>
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}