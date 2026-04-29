import { useState, useEffect } from 'react';
import { FileText, Eye, Download, Send, CheckCircle, X, Trash2, Plus, Layout } from 'lucide-react';
import html2pdf from 'html2pdf.js';
import { supabase } from '../lib/supabase';
import { useToast } from '../context/ToastContext';
import { formatCurrency, getMonthName } from '../lib/payrollCalculator';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Modal } from '../components/ui/Modal';
import { Badge } from '../components/ui/Badge';
import { TableSkeleton } from '../components/ui/Skeleton';
import { PayslipTemplateEditor } from '../components/payslips/PayslipTemplateEditor';
import { PayslipDocument } from '../components/payslips/PayslipDocument';
import { PayslipTemplate } from '../types/payslip';

export interface PayslipFull {
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
    monthly_salary: number;
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
  const [templates, setTemplates] = useState<PayslipTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<PayslipTemplate | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [showSendConfirm, setShowSendConfirm] = useState(false);
  const [sendType, setSendType] = useState<'selected' | 'all'>('selected');
  const [previewPayslip, setPreviewPayslip] = useState<PayslipFull | null>(null);

  useEffect(() => {
    loadPayslips();
    loadTemplates();
  }, []);

  async function loadTemplates() {
    const { data, error } = await supabase
      .from('payslip_templates')
      .select('*')
      .order('created_at', { ascending: false });

    if (!error && data) {
      setTemplates(data);
      if (data.length > 0 && !selectedTemplate) {
        setSelectedTemplate(data[0]);
      }
    }
  }

  async function prepareSendPreview(type: 'selected' | 'all', ids?: Set<string>) {
    setSendType(type);
    let samplePsId = '';

    if (type === 'all') {
      const pending = payslips.find(ps => !ps.email_sent);
      if (pending) samplePsId = pending.id;
    } else if (ids && ids.size > 0) {
      samplePsId = Array.from(ids)[0];
    } else if (selectedIds.size > 0) {
      samplePsId = Array.from(selectedIds)[0];
    }

    if (samplePsId) {
      const ps = payslips.find(p => p.id === samplePsId);
      if (ps) {
        const { data } = await supabase
          .from('payroll_items')
          .select('*')
          .eq('payroll_id', ps.payroll_id)
          .eq('employee_id', ps.employee_id)
          .single();

        if (data) {
          setPreviewPayslip({ ...ps, payroll_item: data });
        }
      }
    }
    setShowSendConfirm(true);
  }

  async function deleteTemplate(id: string) {
    if (!confirm('Are you sure you want to delete this template?')) return;

    const { error } = await supabase.from('payslip_templates').delete().eq('id', id);
    if (!error) {
      showToast('success', 'Template deleted successfully');
      setSelectedTemplate(null);
      loadTemplates();
    } else {
      showToast('error', 'Failed to delete template');
    }
  }

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
          templateId: selectedTemplate?.id
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
          templateId: selectedTemplate?.id
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

    // Set up PDF options
    const options = {
      margin: 10,
      filename: `Payslip_${payslip.employee.name}_${payslip.payroll.month}_${payslip.payroll.year}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { orientation: 'portrait', unit: 'mm', format: 'a4' },
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
              setShowEditor(true);
            }}
          >
            New Template
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
                  onClick={() => deleteTemplate(selectedTemplate.id)}
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
                />
                {selectedTemplate && (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Trash2 size={12} />}
                    onClick={() => deleteTemplate(selectedTemplate.id)}
                    title="Delete Template"
                    className="text-red-500 hover:text-red-600 hover:bg-red-50"
                  />
                )}
              </div>
              <Button size="sm" variant="ghost" icon={<Plus size={12} />} onClick={() => {
                setSelectedTemplate(null);
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
          initialTemplate={selectedTemplate ? { id: selectedTemplate.id, name: selectedTemplate.name, content: selectedTemplate.content } : undefined}
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
        size="lg"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowSendConfirm(false)}>Cancel</Button>
            <Button
              loading={sendingEmail}
              onClick={async () => {
                if (sendType === 'all') await sendAllPendingEmails();
                else await sendEmails();
                setShowSendConfirm(false);
              }}
            >
              Confirm & Send
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg text-blue-700 dark:text-blue-300 text-sm">
            <p className="font-semibold mb-1">Send Confirmation</p>
            <p>You are about to send {sendType === 'all' ? pendingEmailCount : selectedIds.size} payslip(s). Please select a template to use.</p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Select Template</label>
              {selectedTemplate && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Layout size={12} />}
                  onClick={() => setShowEditor(true)}
                  className="h-7 text-blue-600"
                >
                  Edit Selected Template
                </Button>
              )}
            </div>
            <select
              className="w-full border rounded-lg p-2 bg-white dark:bg-slate-800 dark:border-slate-700"
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
          </div>

          {previewPayslip && (
            <div className="border rounded-lg p-4 bg-slate-50 dark:bg-slate-900/50">
              <p className="text-xs font-semibold mb-2 uppercase tracking-wider text-slate-500 flex items-center justify-between">
                <span className="flex items-center gap-2"><Eye size={12} /> Final Preview (Sample: {previewPayslip.employee?.name})</span>
                <span className="text-[10px] font-normal lowercase italic text-slate-400">Scroll to see full document</span>
              </p>
              <div className="h-[600px] overflow-y-auto border shadow-sm bg-white rounded-lg flex justify-center">
                <div className="w-full max-w-[800px]">
                  <PayslipDocument
                    payslip={previewPayslip}
                    templateContent={selectedTemplate?.content}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}