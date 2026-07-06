import { useEffect, useState } from 'react';
import { Users, DollarSign, FileText, CheckCircle, TrendingUp, Clock, Download, ShieldCheck, AlertCircle, Play, Calendar, UserCheck, Fingerprint } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Employee, Payroll, AuditLog } from '../types';
import { formatCurrency, getMonthName } from '../lib/payrollCalculator';
import { KPICard } from '../components/dashboard/KPICard';
import { SalaryChart, DepartmentChart } from '../components/dashboard/SalaryChart';
import { RecentActivity } from '../components/dashboard/RecentActivity';
import { Card, CardHeader } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { useToast } from '../context/ToastContext';

interface ProcessingEmployee extends Omit<Employee, 'status'> {
  totalHours: string;
  missingDays: number;
  leaveDays: number;
  permissionHours: number;
  biometricDays: number;
  monthlySalary: number;
  projectedNetSalary: number;
  status: string;
  holdReason: string | null;
}

export function Dashboard() {
  const { showToast } = useToast();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [payrolls, setPayrolls] = useState<Payroll[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [generatingReport, setGeneratingReport] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'processing'>('overview');

  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());

  // Processing state
  const [processingData, setProcessingData] = useState<ProcessingEmployee[]>([]);
  const [processingLoading, setProcessingLoading] = useState(false);
  const [showHoldModal, setShowHoldModal] = useState<string | null>(null); // employeeId
  const [holdReason, setHoldReason] = useState('');
  const [holdingSalary, setHoldingSalary] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (activeTab === 'processing') loadProcessingData();
  }, [activeTab, selectedMonth, selectedYear]);

  async function loadData() {
    setLoading(true);
    const [empRes, payRes, auditRes] = await Promise.all([
      supabase.from('employees').select('*').order('created_at', { ascending: false }),
      supabase.from('payrolls').select('*').order('year', { ascending: false }).order('month', { ascending: false }).limit(6),
      supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(10),
    ]);
    if (empRes.data) setEmployees(empRes.data);
    if (payRes.data) setPayrolls(payRes.data);
    if (auditRes.data) setAuditLogs(auditRes.data);
    setLoading(false);
  }

  async function loadProcessingData() {
    setProcessingLoading(true);
    try {
      const res = await fetch(`/api/payroll-processing?month=${selectedMonth}&year=${selectedYear}`);
      if (res.ok) setProcessingData(await res.json());
    } catch (e) {
      console.error(e);
      showToast('error', 'Failed to load processing data');
    }
    setProcessingLoading(false);
  }

  async function handleHoldSalary() {
    if (!showHoldModal || !holdReason.trim()) return;
    setHoldingSalary(true);
    try {
      const res = await fetch('/api/payroll-processing/hold', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeId: showHoldModal,
          month: selectedMonth,
          year: selectedYear,
          reason: holdReason
        })
      });
      if (res.ok) {
        showToast('success', 'Salary put on hold');
        setShowHoldModal(null);
        setHoldReason('');
        loadProcessingData();
      } else {
        const d = await res.json();
        showToast('error', d.error || 'Failed to hold salary');
      }
    } catch (e) {
      showToast('error', 'Communication error');
    }
    setHoldingSalary(false);
  }

  async function handleReleaseSalary(employeeId: string) {
    try {
      const res = await fetch('/api/payroll-processing/release', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId, month: selectedMonth, year: selectedYear })
      });
      if (res.ok) {
        showToast('success', 'Salary released');
        loadProcessingData();
      }
    } catch (e) { showToast('error', 'Failed to release salary'); }
  }

  const activeEmployees = employees.filter(e => e.status === 'active');
  const totalSalary = activeEmployees.reduce((s, e) => s + (e.ctc || 0), 0);
  const currentPayroll = payrolls.find(p => p.month === selectedMonth && p.year === selectedYear);
  const pendingPayslipsCount = payrolls.filter(p => p.status !== 'paid').length;

  async function handleDownloadReport() {
    setGeneratingReport(true);
    try {
      const isProcessingReport = activeTab === 'processing';
      const doc = new jsPDF({
        orientation: isProcessingReport ? 'landscape' : 'portrait',
        unit: 'mm',
        format: 'a4'
      });
      
      const monthName = getMonthName(selectedMonth);
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const reportYear = selectedYear;

      // Ensure we have processing data if we're in that tab
      let currentProcessingData = processingData;
      if (isProcessingReport && currentProcessingData.length === 0) {
        const res = await fetch(`/api/payroll-processing?month=${selectedMonth}&year=${selectedYear}`);
        if (res.ok) {
          currentProcessingData = await res.json();
        }
      }

      // --- Modern Header Design ---
      // Background header
      doc.setFillColor(15, 23, 42); // Slate-900
      doc.rect(0, 0, pageWidth, 45, 'F');
      
      // Indigo accent line
      doc.setFillColor(79, 70, 229); // Indigo-600
      doc.rect(0, 45, pageWidth, 2, 'F');

      // Title
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(22);
      doc.setFont('helvetica', 'bold');
      const title = isProcessingReport ? 'PAYROLL PROCESSING QUEUE' : 'MONTHLY PAYROLL REPORT';
      doc.text(title, 20, 25);

      // Subtitle / Date
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(148, 163, 184); // Slate-400
      doc.text(`${monthName.toUpperCase()} ${reportYear}   |   CONCEPT TRUNK INTERIORS`, 20, 33);

      // Status Badge
      const status = currentPayroll ? currentPayroll.status.toUpperCase() : 'PENDING';
      const statusColor = status === 'PAID' ? [16, 185, 129] : [245, 158, 11]; // Emerald : Amber
      doc.setFillColor(...statusColor);
      const statusWidth = doc.getTextWidth(status) + 12;
      doc.roundedRect(pageWidth - statusWidth - 20, 18, statusWidth, 8, 2, 2, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(8);
      doc.setFont('helvetica', 'bold');
      doc.text(status, pageWidth - statusWidth - 14, 23.5);

      let yPos = 60;

      if (isProcessingReport) {
        // --- Admin Panel Detailed Report ---
        doc.setTextColor(30, 41, 59);
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.text('Detailed Attendance & Salary Processing', 20, yPos);
        yPos += 8;

        autoTable(doc, {
          startY: yPos,
          head: [[
            'S.No',
            'Employee Name', 
            'Designation', 
            'Biometric', 
            'Hours', 
            'Missing', 
            'Leave', 
            'Perm.', 
            'Monthly CTC (INR)', 
            'Net Salary (INR)', 
            'Status'
          ]],
          body: currentProcessingData.map((emp, idx) => [
            idx + 1,
            emp.name,
            emp.designation || 'Staff',
            `${emp.biometricDays}d`,
            `${emp.totalHours}h`,
            `${emp.missingDays}d`,
            `${emp.leaveDays}d`,
            `${emp.permissionHours}h`,
            formatCurrency(emp.monthlySalary).replace('₹', ''),
            formatCurrency(emp.projectedNetSalary).replace('₹', ''),
            emp.status.toUpperCase()
          ]),
          theme: 'grid',
          headStyles: { 
            fillColor: [30, 41, 59], 
            textColor: [255, 255, 255],
            fontSize: 7,
            fontStyle: 'bold',
            halign: 'center',
            cellPadding: 2
          },
          bodyStyles: { 
            fontSize: 7,
            textColor: [51, 65, 85],
            cellPadding: 1.5
          },
          columnStyles: {
            0: { halign: 'center', cellWidth: 8 },
            1: { fontStyle: 'bold', cellWidth: 35 },
            2: { cellWidth: 25 },
            3: { halign: 'center', cellWidth: 15 },
            4: { halign: 'center', cellWidth: 15 },
            5: { halign: 'center', cellWidth: 15 },
            6: { halign: 'center', cellWidth: 15 },
            7: { halign: 'center', cellWidth: 15 },
            8: { halign: 'right' },
            9: { halign: 'right', fontStyle: 'bold', textColor: [79, 70, 229] },
            10: { halign: 'center' }
          },
          alternateRowStyles: { fillColor: [248, 250, 252] },
          margin: { left: 15, right: 15 }
        });

        // Totals for Processing Report
        const totalNet = currentProcessingData.reduce((s, e) => s + (e.projectedNetSalary || 0), 0);
        const finalY = (doc as any).lastAutoTable.finalY;
        
        doc.setDrawColor(226, 232, 240);
        doc.line(15, finalY + 5, pageWidth - 15, finalY + 5);
        
        doc.setFontSize(10);
        doc.setTextColor(30, 41, 59);
        doc.setFont('helvetica', 'bold');
        doc.text(`Total Estimated Disbursement: INR ${totalNet.toLocaleString('en-IN')}`, pageWidth - 15, finalY + 12, { align: 'right' });

      } else {
        // --- Overview Report ---
        doc.setTextColor(30, 41, 59);
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.text('Workforce Summary', 20, yPos);
        yPos += 8;

        autoTable(doc, {
          startY: yPos,
          head: [['Metric', 'Value']],
          body: [
            ['Total Employees', employees.length.toString()],
            ['Active Employees', activeEmployees.length.toString()],
            ['Monthly CTC Budget', formatCurrency(totalSalary).replace('₹', 'INR ')],
            ['Average CTC per Employee', formatCurrency(activeEmployees.length ? totalSalary / activeEmployees.length : 0).replace('₹', 'INR ')],
            ['Pending Payrolls Count', pendingPayslipsCount.toString()],
            ['Current Period Status', currentPayroll ? currentPayroll.status.toUpperCase() : 'PENDING']
          ],
          theme: 'striped',
          headStyles: { fillColor: [71, 85, 105] },
          styles: { fontSize: 10, cellPadding: 4 },
          margin: { left: 20, right: 100 }
        });

        yPos = (doc as any).lastAutoTable.finalY + 15;
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.text('Employee List & Status', 20, yPos);
        yPos += 8;

        autoTable(doc, {
          startY: yPos,
          head: [['Name', 'Department', 'Designation', 'CTC (INR)', 'Status']],
          body: employees.map(e => [
            e.name,
            e.department || '—',
            e.designation || '—',
            formatCurrency(e.ctc || 0).replace('₹', ''),
            e.status.toUpperCase()
          ]),
          theme: 'grid',
          headStyles: { fillColor: [30, 64, 175] },
          styles: { fontSize: 8.5, cellPadding: 3 },
          columnStyles: { 3: { halign: 'right' }, 4: { halign: 'center' } },
          margin: { left: 20, right: 20 }
        });
      }

      // --- Footer ---
      const totalPages = (doc as any).internal.getNumberOfPages();
      for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setTextColor(148, 163, 184);
        doc.setDrawColor(226, 232, 240);
        doc.line(15, pageHeight - 15, pageWidth - 15, pageHeight - 15);
        
        doc.text(
          `Generated by Knockturn Payroll System on ${new Date().toLocaleString()} | Concept Trunk Interiors`,
          15,
          pageHeight - 10
        );
        
        doc.text(
          `Page ${i} of ${totalPages}`,
          pageWidth - 15,
          pageHeight - 10,
          { align: 'right' }
        );
      }

      doc.save(`Payroll_Report_${monthName}_${reportYear}.pdf`);
      showToast('success', 'Professional report downloaded');
    } catch (error) {
      console.error('Report Error:', error);
      showToast('error', 'Failed to generate professional report');
    }
    setGeneratingReport(false);
  }

  const chartData = [...payrolls]
    .sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month)
    .map(p => ({ month: p.month, year: p.year, total: p.total_amount }));

  const deptMap = new Map<string, number>();
  employees.forEach(e => {
    const dept = e.department || 'General';
    deptMap.set(dept, (deptMap.get(dept) || 0) + 1);
  });
  const deptData = Array.from(deptMap.entries()).map(([department, count]) => ({
    department, count, total: 0
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <button
            onClick={() => setActiveTab('overview')}
            className={`text-xl font-bold transition-all ${activeTab === 'overview' ? 'text-slate-800 dark:text-white underline decoration-indigo-500 underline-offset-8' : 'text-slate-400 dark:text-slate-500'}`}
          >
            Overview
          </button>
          <button
            onClick={() => setActiveTab('processing')}
            className={`text-xl font-bold transition-all flex items-center gap-2 ${activeTab === 'processing' ? 'text-slate-800 dark:text-white underline decoration-indigo-500 underline-offset-8' : 'text-slate-400 dark:text-slate-500'}`}
          >
            <ShieldCheck size={20} /> Admin Panel
          </button>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-1 shadow-sm">
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(Number(e.target.value))}
              className="bg-transparent text-xs font-semibold px-2 py-1 outline-none text-slate-700 dark:text-slate-200 border-r border-slate-100 dark:border-slate-700"
            >
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(m => (
                <option key={m} value={m}>{getMonthName(m)}</option>
              ))}
            </select>
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              className="bg-transparent text-xs font-semibold px-2 py-1 outline-none text-slate-700 dark:text-slate-200"
            >
              {[2024, 2025, 2026].map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>

          <button
            onClick={handleDownloadReport}
            disabled={generatingReport || loading}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-all font-semibold text-sm shadow-md shadow-indigo-200 dark:shadow-none disabled:opacity-50"
          >
            <Download size={16} />
            {generatingReport ? 'Generating...' : 'Download Report'}
          </button>

          <Badge variant={currentPayroll?.status === 'paid' ? 'success' : currentPayroll?.status === 'completed' ? 'info' : 'warning'} dot>
            {currentPayroll ? currentPayroll.status.charAt(0).toUpperCase() + currentPayroll.status.slice(1) : 'Not Generated'}
          </Badge>
        </div>
      </div>

      {activeTab === 'overview' ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            <KPICard
              title="Total Employees"
              value={String(activeEmployees.length)}
              subtitle={`${employees.filter(e => e.status === 'inactive').length} inactive`}
              icon={<Users size={20} className="text-blue-600" />}
              iconColor="bg-blue-100 dark:bg-blue-900/30"
              trend={{ value: 0, label: 'this month' }}
              loading={loading}
            />
            <KPICard
              title="Monthly Salary Budget"
              value={formatCurrency(totalSalary)}
              subtitle={`Avg: ${formatCurrency(activeEmployees.length ? totalSalary / activeEmployees.length : 0)}/emp`}
              icon={<DollarSign size={20} className="text-emerald-600" />}
              iconColor="bg-emerald-100 dark:bg-emerald-900/30"
              loading={loading}
            />
            <KPICard
              title="Pending Payrolls"
              value={String(pendingPayslipsCount)}
              subtitle="Awaiting disbursement"
              icon={<FileText size={20} className="text-amber-600" />}
              iconColor="bg-amber-100 dark:bg-amber-900/30"
              loading={loading}
            />
            <KPICard
              title="Payroll Status"
              value={currentPayroll ? currentPayroll.status.toUpperCase() : 'PENDING'}
              subtitle={`${getMonthName(selectedMonth)} ${selectedYear}`}
              icon={<CheckCircle size={20} className="text-cyan-600" />}
              iconColor="bg-cyan-100 dark:bg-cyan-900/30"
              loading={loading}
            />
            <KPICard
              title="Team Productivity"
              value="92%"
              subtitle="Based on timesheet data"
              icon={<TrendingUp size={20} className="text-rose-600" />}
              iconColor="bg-rose-100 dark:bg-rose-900/30"
              trend={{ value: 3.2, label: 'vs last month' }}
              loading={loading}
            />
            <KPICard
              title="Avg Processing Time"
              value="< 2 min"
              subtitle="Payroll generation speed"
              icon={<Clock size={20} className="text-orange-600" />}
              iconColor="bg-orange-100 dark:bg-orange-900/30"
              loading={loading}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <SalaryChart data={chartData} loading={loading} />
            <DepartmentChart data={deptData} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2">
              <Card padding={false}>
                <div className="p-5 border-b border-slate-200 dark:border-slate-700">
                  <CardHeader title="Employee Overview" subtitle="Active workforce snapshot" />
                </div>
                <div className="overflow-x-auto">
                  {loading ? (
                    <div className="p-5 space-y-3">
                      {[1, 2, 3].map(i => (
                        <div key={i} className="flex gap-4 animate-pulse">
                          <div className="w-8 h-8 bg-slate-200 dark:bg-slate-700 rounded-full" />
                          <div className="flex-1 space-y-1.5">
                            <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded w-1/3" />
                            <div className="h-3 bg-slate-100 dark:bg-slate-700/60 rounded w-1/4" />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-100 dark:border-slate-700/50">
                          <th className="text-left py-3 px-5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Employee</th>
                          <th className="text-left py-3 px-5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider hidden sm:table-cell">Department</th>
                          <th className="text-right py-3 px-5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">CTC</th>
                          <th className="text-center py-3 px-5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {employees.slice(0, 8).map(emp => (
                          <tr key={emp.id} className="border-b border-slate-50 dark:border-slate-700/30 hover:bg-slate-50/50 dark:hover:bg-slate-700/20 transition-colors">
                            <td className="py-3 px-5">
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-indigo-700 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                                  {emp.name.charAt(0).toUpperCase()}
                                </div>
                                <div>
                                  <p className="font-medium text-slate-700 dark:text-slate-200 text-xs">{emp.name}</p>
                                  <p className="text-slate-400 text-[10px]">{emp.email}</p>
                                </div>
                              </div>
                            </td>
                            <td className="py-3 px-5 hidden sm:table-cell">
                              <span className="text-xs text-slate-500 dark:text-slate-400">{emp.department || '—'}</span>
                            </td>
                            <td className="py-3 px-5 text-right">
                              <span className="font-semibold text-slate-700 dark:text-slate-200 text-xs">{formatCurrency(emp.ctc || 0)}</span>
                            </td>
                            <td className="py-3 px-5 text-center">
                              <Badge variant={emp.status === 'active' ? 'success' : 'neutral'} dot>
                                {emp.status}
                              </Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </Card>
            </div>
            <RecentActivity logs={auditLogs} loading={loading} />
          </div>
        </>
      ) : (
        /* ─── Admin Panel / Salary Processing ─── */
        <Card padding={false}>
          <div className="p-5 border-b border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="font-bold text-slate-800 dark:text-white flex items-center gap-2">
                Salary Processing Queue
                <span className="px-2 py-0.5 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 text-[10px] rounded-full uppercase tracking-widest font-bold">
                  {processingData.length} Employees
                </span>
              </h3>
              <p className="text-xs text-slate-500 mt-1">Review attendance and mark salary status for {getMonthName(selectedMonth)} {selectedYear}.</p>
            </div>
          </div>

          <div className="overflow-x-auto">
            {processingLoading ? (
              <div className="p-10 text-center text-slate-400 animate-pulse">
                Loading processing queue...
              </div>
            ) : processingData.length === 0 ? (
              <div className="py-20 text-center text-slate-400 italic">
                No active employees found for this period.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/30 border-b border-slate-200 dark:border-slate-700">
                    <th className="text-left py-4 px-6 font-bold text-slate-500 uppercase text-[10px] tracking-wider">Employee</th>
                    <th className="text-center py-4 px-6 font-bold text-slate-500 uppercase text-[10px] tracking-wider">Biometric Present</th>
                    <th className="text-center py-4 px-6 font-bold text-slate-500 uppercase text-[10px] tracking-wider">Working Hours</th>
                    <th className="text-center py-4 px-6 font-bold text-slate-500 uppercase text-[10px] tracking-wider">Timesheet Missing</th>
                    <th className="text-center py-4 px-6 font-bold text-slate-500 uppercase text-[10px] tracking-wider">Days Leave</th>
                    <th className="text-center py-4 px-6 font-bold text-slate-500 uppercase text-[10px] tracking-wider">Permission</th>
                    <th className="text-center py-4 px-6 font-bold text-slate-500 uppercase text-[10px] tracking-wider">Monthly CTC</th>
                    <th className="text-center py-4 px-6 font-bold text-slate-500 uppercase text-[10px] tracking-wider">Est. Net Salary</th>
                    <th className="text-center py-4 px-6 font-bold text-slate-500 uppercase text-[10px] tracking-wider">Status</th>
                    <th className="text-right py-4 px-6 font-bold text-slate-500 uppercase text-[10px] tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {processingData.map(emp => (
                    <tr key={emp.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-700/20 transition-colors">
                      <td className="py-4 px-6">
                        <div className="flex items-center gap-3">
                          <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold text-white shadow-sm ${emp.status === 'held' ? 'bg-amber-500' : 'bg-slate-800'}`}>
                            {emp.name.charAt(0)}
                          </div>
                          <div>
                            <p className="font-bold text-slate-700 dark:text-slate-200">{emp.name}</p>
                            <p className="text-[10px] text-slate-400 uppercase tracking-tighter">{emp.designation || 'Staff'}</p>
                          </div>
                        </div>
                      </td>
                      <td className="py-4 px-6 text-center">
                        <span className="px-2 py-1 bg-cyan-50 text-cyan-600 rounded-md text-[11px] font-bold flex items-center justify-center gap-1.5">
                          <Fingerprint size={10} /> {emp.biometricDays} Days
                        </span>
                      </td>
                      <td className="py-4 px-6 text-center">
                        <div className="flex flex-col items-center">
                          <span className={`font-mono font-bold ${Number(emp.totalHours) < 100 ? 'text-rose-500' : 'text-slate-700 dark:text-slate-300'}`}>
                            {emp.totalHours} hrs
                          </span>
                        </div>
                      </td>
                      <td className="py-4 px-6 text-center">
                        <span className={`px-2 py-1 rounded-md text-[11px] font-bold flex items-center justify-center gap-1.5 ${emp.missingDays > 3 ? 'bg-rose-50 text-rose-600' : 'bg-slate-100 text-slate-600'}`}>
                          <Clock size={10} /> {emp.missingDays} Days
                        </span>
                      </td>
                      <td className="py-4 px-6 text-center">
                        <span className="px-2 py-1 bg-blue-50 text-blue-600 rounded-md text-[11px] font-bold flex items-center justify-center gap-1.5">
                          <Calendar size={10} /> {emp.leaveDays} Days
                        </span>
                      </td>
                      <td className="py-4 px-6 text-center">
                        <span className="px-2 py-1 bg-emerald-50 text-emerald-600 rounded-md text-[11px] font-bold flex items-center justify-center gap-1.5">
                          <UserCheck size={10} /> {emp.permissionHours} hrs
                        </span>
                      </td>
                      <td className="py-4 px-6 text-center">
                        <span className="font-bold text-slate-700 dark:text-slate-300">
                          {formatCurrency(emp.monthlySalary)}
                        </span>
                      </td>
                      <td className="py-4 px-6 text-center">
                        <span className="font-black text-indigo-600 dark:text-indigo-400">
                          {formatCurrency(emp.projectedNetSalary)}
                        </span>
                      </td>
                      <td className="py-4 px-6 text-center">
                        <div className="flex flex-col items-center gap-1">
                          <Badge variant={emp.status === 'paid' ? 'success' : emp.status === 'held' ? 'warning' : 'neutral'} dot>
                            {emp.status === 'NOT_GENERATED' ? 'Not Generated' : emp.status.toUpperCase()}
                          </Badge>
                          {emp.holdReason && (
                            <p className="text-[10px] text-amber-600 italic max-w-[150px] truncate" title={emp.holdReason}>
                              "{emp.holdReason}"
                            </p>
                          )}
                        </div>
                      </td>
                      <td className="py-4 px-6 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {emp.status === 'held' ? (
                            <button
                              onClick={() => handleReleaseSalary(emp.id)}
                              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 text-xs font-bold rounded-lg transition-all border border-emerald-100"
                            >
                              <Play size={14} /> Release
                            </button>
                          ) : (
                            <>
                              <button
                                onClick={() => setShowHoldModal(emp.id)}
                                disabled={emp.status === 'NOT_GENERATED'}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 text-amber-600 hover:bg-amber-100 text-xs font-bold rounded-lg transition-all border border-amber-100 disabled:opacity-30"
                              >
                                <AlertCircle size={14} /> Hold Salary
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Card>
      )}

      {/* ─── Hold Salary Modal ─── */}
      {showHoldModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-slate-200 dark:border-slate-700">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-slate-800 dark:text-white flex items-center gap-2">
                  <AlertCircle className="text-amber-500" /> Hold Salary
                </h3>
              </div>
              <p className="text-sm text-slate-500">
                Specify the reason for holding the salary for <b>{processingData.find(e => e.id === showHoldModal)?.name}</b>. An email notification will be sent automatically.
              </p>

              <div className="mt-6">
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Reason for Hold</label>
                <textarea
                  value={holdReason}
                  onChange={(e) => setHoldReason(e.target.value)}
                  placeholder="e.g. Timesheet mismatch, Pending documentation..."
                  className="w-full h-32 px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-sm resize-none"
                />
              </div>

              <div className="mt-8 flex gap-3">
                <button
                  onClick={() => { setShowHoldModal(null); setHoldReason(''); }}
                  className="flex-1 px-4 py-2.5 text-slate-500 font-bold text-sm hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={handleHoldSalary}
                  disabled={holdingSalary || !holdReason.trim()}
                  className="flex-1 px-4 py-2.5 bg-indigo-600 text-white font-bold text-sm rounded-xl hover:bg-indigo-700 shadow-lg shadow-indigo-200 dark:shadow-none disabled:opacity-50 transition-all flex items-center justify-center gap-2"
                >
                  {holdingSalary ? 'Processing...' : 'Confirm Hold'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
