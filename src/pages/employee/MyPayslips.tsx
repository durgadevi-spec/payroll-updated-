import { useState, useEffect } from 'react';
import { FileText, Eye, Download, X } from 'lucide-react';
import html2pdf from 'html2pdf.js';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { getMonthName } from '../../lib/payrollCalculator';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Modal } from '../../components/ui/Modal';
import { Badge } from '../../components/ui/Badge';
import { TableSkeleton } from '../../components/ui/Skeleton';
import { PayslipDocument } from '../../components/payslips/PayslipDocument';

export function MyPayslips() {
  const { user } = useAuth();
  const [payslips, setPayslips] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewPayslip, setViewPayslip] = useState<any | null>(null);

  useEffect(() => {
    loadPayslips();
  }, []);

  async function loadPayslips() {
    setLoading(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const res = await fetch('/api/me/payslips', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setPayslips(data || []);
      }
    } catch (error) {
      console.error('Load payslips error:', error);
      setPayslips([]);
    }
    setLoading(false);
  }

  function downloadPayslipPDF(payslip: any) {
    const element = document.getElementById('payslip-content');
    if (!element) return;

    const clonedElement = element.cloneNode(true) as HTMLElement;
    const options = {
      margin: 10,
      filename: `Payslip_${payslip.employee.name}_${payslip.payroll.month}_${payslip.payroll.year}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { orientation: 'portrait', unit: 'mm', format: 'a4' },
    };

    html2pdf().set(options).from(clonedElement).save();
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">My Payslips</h1>
          <p className="text-slate-500 text-sm mt-1">View and download your monthly salary slips</p>
        </div>
      </div>

      <Card padding={false}>
        <div className="p-4 border-b border-slate-200 dark:border-slate-700">
          <p className="font-semibold text-slate-800 dark:text-white text-sm">All Payslips</p>
        </div>

        <div className="overflow-x-auto">
          {loading ? (
            <div className="p-5"><TableSkeleton rows={4} cols={4} /></div>
          ) : payslips.length === 0 ? (
            <div className="py-16 text-center">
              <FileText size={36} className="mx-auto text-slate-300 dark:text-slate-600 mb-3" />
              <p className="text-slate-500 dark:text-slate-400 text-sm">No payslips generated yet</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-700">
                  <th className="py-3 px-4 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider text-left">Period</th>
                  <th className="py-3 px-4 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider text-left">Generated On</th>
                  <th className="py-3 px-4 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider text-left">Status</th>
                  <th className="py-3 px-4 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {payslips.map(ps => (
                  <tr key={ps.id} className="border-b border-slate-50 dark:border-slate-700/30 hover:bg-slate-50/50 dark:hover:bg-slate-700/20 transition-colors">
                    <td className="py-3 px-4 font-medium text-slate-800 dark:text-slate-200">
                      {ps.payroll ? `${getMonthName(ps.payroll.month)} ${ps.payroll.year}` : '—'}
                    </td>
                    <td className="py-3 px-4 text-slate-500">
                      {ps.created_at ? new Date(ps.created_at).toLocaleDateString() : '—'}
                    </td>
                    <td className="py-3 px-4">
                      <Badge variant="info" dot>{ps.status}</Badge>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => setViewPayslip(ps)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors"
                          title="Preview"
                        >
                          <Eye size={16} />
                        </button>
                        <button
                          onClick={() => {
                            // Render invisibly then download? No, if we want to download directly we should just use the modal or we can show modal then download.
                            // To keep it simple, we just show the preview and let them download.
                            setViewPayslip(ps);
                          }}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 transition-colors"
                          title="Download"
                        >
                          <Download size={16} />
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
          <div className="flex justify-end gap-2 w-full">
            <Button variant="outline" onClick={() => setViewPayslip(null)}>Close</Button>
            <Button icon={<Download size={14} />} onClick={() => { if (viewPayslip) downloadPayslipPDF(viewPayslip); }}>Download PDF</Button>
          </div>
        }
      >
        {viewPayslip && (
          <div className="space-y-4">
            <div className="border rounded-lg bg-white overflow-hidden shadow-sm">
              <PayslipDocument
                payslip={viewPayslip}
                templateContent={undefined}
                editable={false}
              />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
