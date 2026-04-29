import React, { useState, useEffect } from 'react';
import {
  Calendar as CalendarIcon, LayoutDashboard, Users, UserPlus, LogOut, CheckCircle2,
  Search, Filter, ChevronLeft, ChevronRight, XCircle,
  Building, MapPin, Mail, Settings, Clock, LogIn, UserCheck,
  Download, FileText, AlertCircle, Calendar, RefreshCw,
  Trash2, Edit3, Save, X, AlertTriangle, ChevronDown, Maximize2, Minimize2,
  FileSpreadsheet, UserX
} from 'lucide-react';
import { format, subDays, startOfMonth, endOfMonth } from 'date-fns';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

export function DailyAnalysis() {
  const [selectedDate, setSelectedDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [employeesData, setEmployeesData] = useState<any[]>([]);
  const [selectedEmployee, setSelectedEmployee] = useState<any | null>(null);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [expandedTasks, setExpandedTasks] = useState<number[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [deviceIp, setDeviceIp] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'present' | 'absent' | 'pending' | 'leave'>('all');
  const [showFilterMenu, setShowFilterMenu] = useState(false);

  const [reportEmployeeId, setReportEmployeeId] = useState('');
  const [reportMonth, setReportMonth] = useState(new Date().getMonth() + 1);
  const [reportYear, setReportYear] = useState(new Date().getFullYear());
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);

  useEffect(() => {
    fetchData();
    fetchSettings();
  }, [selectedDate]);

  async function fetchSettings() {
    try {
      const res = await fetch('/api/settings');
      if (res.ok) {
        const data = await res.json();
        if (data.biometric_ip) setDeviceIp(data.biometric_ip);
      }
    } catch (e) { }
  }

  const handleUpdateSettings = async () => {
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ biometric_ip: deviceIp })
      });
      if (res.ok) {
        setShowSettings(false);
        alert("Device IP updated successfully.");
      }
    } catch (e) {
      alert("Failed to update settings.");
    }
  };



  const handleDownloadBySelection = async () => {
    if (!reportEmployeeId) {
      alert("Please select an employee first.");
      return;
    }
    setIsGeneratingReport(true);
    const emp = employeesData.find(e => e.id === reportEmployeeId);
    if (emp) {
      await handleDownloadMonthlyReport(emp, reportMonth, reportYear);
    }
    setIsGeneratingReport(false);
  };

  const handleDownloadMonthlyReport = async (employee: any, overrideMonth?: number, overrideYear?: number) => {
    try {
      const date = new Date(selectedDate);
      const month = overrideMonth || (date.getMonth() + 1);
      const year = overrideYear || date.getFullYear();

      const res = await fetch(`/api/employee-monthly-report?employeeId=${employee.id}&month=${month}&year=${year}`);
      if (!res.ok) throw new Error('Failed to fetch report data');

      const { employee: empDetails, report } = await res.json();

      const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4'
      });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();

      // --- Premium Header Design ---
      doc.setFillColor(15, 23, 42); // Slate-900
      doc.rect(0, 0, pageWidth, 48, 'F');
      
      doc.setFillColor(79, 70, 229); // Indigo-600
      doc.rect(0, 48, pageWidth, 1.5, 'F');

      // Main Title
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(20);
      doc.setFont('helvetica', 'bold');
      doc.text('MONTHLY ATTENDANCE REPORT', 15, 20);

      const monthName = new Date(year, month - 1).toLocaleString('en-US', { month: 'long' });
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(148, 163, 184); // Slate-400
      doc.text(`${monthName.toUpperCase()} ${year}   |   KNOCKTURN PAYROLL SYSTEM`, 15, 27);

      // Employee Info (Neatly arranged on the left)
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.text(empDetails.name.toUpperCase(), 15, 36);
      
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(203, 213, 225); // Slate-300
      doc.text(`Department: ${empDetails.department || 'Operations'}`, 15, 41);
      doc.text(`Employee Code: ${empDetails.employee_code || 'N/A'}`, 60, 41);

      // --- Attendance Table ---
      autoTable(doc, {
        startY: 55,
        head: [['Date', 'Day', 'Punch In', 'Punch Out', 'Dur.', 'TS (TimeStrap)', 'Status']],
        body: report.map((day: any) => [
          day.date.split('-').slice(2).join(''),
          day.day,
          day.attendance?.in || '-',
          day.attendance?.out || '-',
          day.attendance?.duration || '-',
          day.timesheet || '-',
          day.leave ? `LEAVE (${day.leave})` : (day.attendance ? 'PRESENT' : (day.isSunday ? 'SUN' : 'ABSENT'))
        ]),
        theme: 'grid',
        headStyles: { 
          fillColor: [30, 41, 59], 
          textColor: 255, 
          fontSize: 7.5, 
          fontStyle: 'bold', 
          halign: 'center',
          cellPadding: 2
        },
        bodyStyles: { 
          fontSize: 7.5, 
          halign: 'center',
          textColor: [51, 65, 85],
          cellPadding: 1.8
        },
        columnStyles: {
          0: { cellWidth: 10 },
          1: { cellWidth: 12 },
          2: { cellWidth: 20 },
          3: { cellWidth: 20 },
          4: { cellWidth: 20 },
          5: { cellWidth: 28, fontStyle: 'bold', textColor: [79, 70, 229] },
          6: { halign: 'left' }
        },
        alternateRowStyles: { fillColor: [250, 251, 253] },
        margin: { left: 15, right: 15 },
        didParseCell: (data) => {
          const rowIndex = data.row.index;
          const isSunday = report[rowIndex]?.isSunday;

          if (data.section === 'body') {
            // Highlight Sunday rows
            if (isSunday) {
              data.cell.styles.fillColor = [241, 245, 249]; // Light Slate for Sunday
            }

            // Status color coding
            if (data.column.index === 6) {
              const val = data.cell.text[0];
              if (val === 'PRESENT') data.cell.styles.textColor = [22, 163, 74];
              if (val === 'ABSENT') data.cell.styles.textColor = [220, 38, 38];
              if (val.includes('LEAVE')) data.cell.styles.textColor = [147, 51, 234];
              if (val === 'SUN') {
                data.cell.styles.fontStyle = 'bold';
                data.cell.styles.textColor = [100, 116, 139];
              }
            }
          }
        }
      });

      // --- Summary Section ---
      const finalY = (doc as any).lastAutoTable.finalY + 12;
      const presentDays = report.filter((d: any) => d.attendance).length;
      const leaves = report.filter((d: any) => d.leave).length;

      doc.setDrawColor(226, 232, 240);
      doc.line(15, finalY - 5, pageWidth - 15, finalY - 5);

      doc.setTextColor(30, 41, 59);
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.text('Monthly Summary', 15, finalY);

      doc.setFontSize(8.5);
      doc.setFont('helvetica', 'normal');
      doc.text(`Total Present Days: ${presentDays}`, 15, finalY + 7);
      doc.text(`Total Approved Leaves: ${leaves}`, 15, finalY + 13);
      doc.text(`Generated On: ${format(new Date(), 'yyyy-MM-dd HH:mm')}`, pageWidth - 15, finalY + 13, { align: 'right' });

      // --- Footer ---
      const totalPages = (doc as any).internal.getNumberOfPages();
      for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        doc.setFontSize(7.5);
        doc.setTextColor(148, 163, 184);
        doc.line(15, pageHeight - 12, pageWidth - 15, pageHeight - 12);
        
        doc.text(
          `Knockturn Payroll System | Monthly Attendance Report`,
          15,
          pageHeight - 8
        );
        
        doc.text(
          `Page ${i} of ${totalPages}`,
          pageWidth - 15,
          pageHeight - 8,
          { align: 'right' }
        );
      }

      doc.save(`Attendance_Report_${empDetails.name.replace(/\s+/g, '_')}_${monthName}_${year}.pdf`);
    } catch (err) {
      console.error(err);
      alert('Failed to generate PDF report');
    }
  };

  async function fetchData() {
    setLoading(true);
    try {
      const res = await fetch(`/api/daily-analysis?date=${selectedDate}`);
      if (res.ok) {
        const data = await res.json();
        setEmployeesData(data);
      }
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  }

  const handleSyncDirect = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/attendance/sync-direct', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        alert(data.message);
        fetchData();
      } else {
        alert(data.error);
      }
    } catch (e) {
      alert("Failed to connect to biometric machine. Please check your network connection.");
    }
    setLoading(false);
  };

  const stats = {
    timesheet: {
      expected: employeesData.length,
      submitted: employeesData.filter(e => e.timesheet).length,
      notSubmitted: employeesData.filter(e => !e.timesheet).length,
      approved: employeesData.filter(e => e.timesheet).length,
      pending: 0,
      rejected: 0,
      late: 0
    },
    lms: {
      totalRequests: employeesData.filter(e => e.leave).length,
      approved: employeesData.filter(e => e.leave?.status === 'Approved').length,
      pending: employeesData.filter(e => e.leave?.status === 'Pending').length,
      rejected: employeesData.filter(e => e.leave?.status === 'Rejected').length
    },
    attendance: {
      present: employeesData.filter(e => {
        const hasTimesheet = !!e.timesheet && !!e.timesheet.hours;
        const isOD = e.leave?.type === 'OD' && e.leave?.status === 'Approved';
        return hasTimesheet && (e.attendance || isOD);
      }).length,
      absent: employeesData.filter(e => {
        const hasTimesheet = !!e.timesheet && !!e.timesheet.hours;
        const isOD = e.leave?.type === 'OD' && e.leave?.status === 'Approved';
        const isLeave = e.leave && e.leave.type !== 'OD';
        return !isLeave && (!hasTimesheet || (!e.attendance && !isOD));
      }).length,
      late: 0,
      overtime: 0
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Daily Analysis</h1>
          <p className="text-slate-500 text-sm mt-1">Operational summary from TimeStrap, LMS, and Attendance</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <CalendarIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              max={format(new Date(), 'yyyy-MM-dd')}
              className="pl-10 pr-4 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button
            onClick={() => setShowReportModal(true)}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-all shadow-lg shadow-blue-500/20"
          >
            <FileText size={16} />
            Generate Report
          </button>
          <button
            onClick={handleSyncDirect}
            disabled={loading}
            className="flex items-center gap-2 bg-slate-800 dark:bg-slate-700 hover:bg-slate-900 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
          >
            <Clock size={16} />
            {loading ? 'Syncing...' : 'Sync Device'}
          </button>
          <button
            onClick={() => setShowSettings(true)}
            className="p-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
            title="Configure Device"
          >
            <Settings size={18} />
          </button>
        </div>
      </div>


      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* TimeStrap Summary */}
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
          <div className="p-4 border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
            <h2 className="font-semibold text-slate-800 dark:text-white flex items-center gap-2">
              <Clock size={18} className="text-blue-500" />
              TimeStrap Analysis
            </h2>
          </div>
          <div className="p-4 grid grid-cols-2 gap-4">
            <StatCard label="Expected" value={stats.timesheet.expected} icon={<Users size={16} />} color="blue" />
            <StatCard label="Submitted" value={stats.timesheet.submitted} icon={<CheckCircle2 size={16} />} color="green" />
            <StatCard label="Pending" value={stats.timesheet.pending} icon={<Clock size={16} />} color="orange" />
            <StatCard label="Not Submitted" value={stats.timesheet.notSubmitted} icon={<XCircle size={16} />} color="red" />
          </div>
        </div>

        {/* LMS Leave Summary */}
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
          <div className="p-4 border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
            <h2 className="font-semibold text-slate-800 dark:text-white flex items-center gap-2">
              <CalendarIcon size={18} className="text-purple-500" />
              LMS Leave Analysis
            </h2>
          </div>
          <div className="p-4 grid grid-cols-2 gap-4">
            <StatCard label="Total Requests" value={stats.lms.totalRequests} icon={<FileSpreadsheet size={16} />} color="purple" />
            <StatCard label="Approved" value={stats.lms.approved} icon={<CheckCircle2 size={16} />} color="green" />
            <StatCard label="Pending" value={stats.lms.pending} icon={<Clock size={16} />} color="orange" />
            <StatCard label="Rejected" value={stats.lms.rejected} icon={<XCircle size={16} />} color="red" />
          </div>
        </div>

        {/* Attendance Summary */}
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
          <div className="p-4 border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
            <h2 className="font-semibold text-slate-800 dark:text-white flex items-center gap-2">
              <UserCheck size={18} className="text-teal-500" />
              Attendance Insights
            </h2>
          </div>
          <div className="p-4 grid grid-cols-2 gap-4">
            <StatCard label="Present" value={stats.attendance.present} icon={<UserCheck size={16} />} color="teal" />
            <StatCard label="Absent" value={stats.attendance.absent} icon={<UserX size={16} />} color="red" />
            <StatCard label="Late Check-ins" value={stats.attendance.late} icon={<AlertTriangle size={16} />} color="orange" />
            <StatCard label="Overtime" value={stats.attendance.overtime} icon={<Clock size={16} />} color="blue" />
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
        <div className="p-5 border-b border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <h3 className="font-semibold text-slate-800 dark:text-white">Detailed Employee Status</h3>
          <div className="flex items-center gap-3 w-full sm:w-auto">
            <div className="relative flex-1 sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input
                type="text"
                placeholder="Search employees..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-sm focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="relative">
              <button
                onClick={() => setShowFilterMenu(!showFilterMenu)}
                className={`p-2 border rounded-lg transition-colors ${statusFilter !== 'all' ? 'bg-blue-50 border-blue-200 text-blue-600 dark:bg-blue-900/30 dark:border-blue-800' : 'border-slate-300 dark:border-slate-600 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-700'}`}
                title="Filter by Status"
              >
                <Filter size={16} />
              </button>

              {showFilterMenu && (
                <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl z-10 py-1 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                  <div className="px-3 py-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Filter by Status</div>
                  <FilterOption label="All Employees" active={statusFilter === 'all'} onClick={() => { setStatusFilter('all'); setShowFilterMenu(false); }} />
                  <FilterOption label="Present Only" active={statusFilter === 'present'} onClick={() => { setStatusFilter('present'); setShowFilterMenu(false); }} />
                  <FilterOption label="Absent Only" active={statusFilter === 'absent'} onClick={() => { setStatusFilter('absent'); setShowFilterMenu(false); }} />
                  <FilterOption label="Pending Timesheets" active={statusFilter === 'pending'} onClick={() => { setStatusFilter('pending'); setShowFilterMenu(false); }} />
                  <FilterOption label="On Leave" active={statusFilter === 'leave'} onClick={() => { setStatusFilter('leave'); setShowFilterMenu(false); }} />
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
          <div className="flex gap-2">
            <button
              onClick={handleSyncDirect}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-blue-500/20 disabled:opacity-50"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              Sync Biometric
            </button>
            <button
              onClick={() => fetchData()}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all disabled:opacity-50"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              Refresh View
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 uppercase text-xs">
              <tr>
                <th className="px-6 py-4 font-medium">Employee</th>
                <th className="px-6 py-4 font-medium">Department</th>
                <th className="px-6 py-4 font-medium">TimeStrap Status</th>
                <th className="px-6 py-4 font-medium">LMS Status</th>
                <th className="px-6 py-4 font-medium">Biometric</th>
                <th className="px-6 py-4 font-medium">TS Hours</th>
                <th className="px-6 py-4 font-medium text-center">Final Status</th>
                <th className="px-6 py-4 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-slate-500">
                    Loading daily data...
                  </td>
                </tr>
              ) : employeesData.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-slate-500">
                    No employees found
                  </td>
                </tr>
              ) : employeesData
                .filter(e => {
                  // Search filter
                  const matchesSearch = !searchQuery || e.name.toLowerCase().includes(searchQuery.toLowerCase());
                  if (!matchesSearch) return false;

                  // Status filter
                  if (statusFilter === 'all') return true;
                  if (statusFilter === 'present') return !!e.attendance || (!!e.timesheet && !!e.timesheet.hours);
                  if (statusFilter === 'absent') return !e.attendance && (!e.timesheet || !e.timesheet.hours) && !e.leave;
                  if (statusFilter === 'pending') return !e.timesheet;
                  if (statusFilter === 'leave') return !!e.leave;

                  return true;
                })
                .map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold text-xs">
                          {item.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div className="font-medium text-slate-900 dark:text-white">{item.name}</div>
                          <div className="text-xs text-slate-500">{item.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-slate-600 dark:text-slate-300">
                      <div className="flex items-center gap-1.5">
                        <Building size={14} className="text-slate-400" />
                        {item.department || '—'}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {item.timesheet ? (
                        item.timesheet.admin_approved ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border border-green-200 dark:border-green-800">
                            <CheckCircle2 size={12} /> Admin Approved
                          </span>
                        ) : item.timesheet.manager_approved ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border border-blue-200 dark:border-blue-800">
                            <UserCheck size={12} /> Manager Approved
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
                            <Clock size={12} /> Submitted
                          </span>
                        )
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border border-red-200 dark:border-red-800">
                          <XCircle size={12} /> Not Submitted
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {item.leave ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400 border border-purple-200 dark:border-purple-800">
                          {item.leave.type} ({item.leave.status})
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                          Working
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {(() => {
                        const isOD = item.leave?.type === 'OD' && item.leave?.status === 'Approved';
                        const isLeave = item.leave && item.leave.type !== 'OD';

                        if (isOD) return <span className="text-indigo-600 font-bold text-xs uppercase">OD / WFH</span>;
                        if (isLeave) return <span className="text-slate-400 text-xs font-medium italic">On {item.leave.type}</span>;
                        if (!item.attendance) return <span className="text-red-500/60 text-[10px] font-bold uppercase">Missing</span>;

                        return (
                          <div className="flex flex-col whitespace-nowrap">
                            <div className="text-teal-600 font-bold text-xs">IN: {new Date(item.attendance.first_punch).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                            {item.attendance.last_punch && item.attendance.last_punch !== item.attendance.first_punch && (
                              <div className="text-amber-600 font-bold text-xs">OUT: {new Date(item.attendance.last_punch).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                    <td className="px-6 py-4">
                      {item.timesheet && item.timesheet.hours ? (
                        <span className="text-blue-600 font-bold text-xs">
                          {item.timesheet.hours}
                        </span>
                      ) : (
                        <span className="text-red-500/60 text-[10px] font-bold uppercase">Missing</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-center">
                      {(() => {
                        const hasTimesheet = !!item.timesheet && !!item.timesheet.hours;
                        const isOD = item.leave?.type === 'OD' && item.leave?.status === 'Approved';
                        const isPresent = hasTimesheet && (item.attendance || isOD);
                        const isLeave = item.leave && item.leave.type !== 'OD';

                        if (isLeave) return <span className="text-slate-400 text-xs font-medium bg-slate-100 px-2 py-1 rounded">ON LEAVE</span>;

                        if (isPresent) return (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-green-100 text-green-700 border border-green-200 uppercase">
                            <CheckCircle2 size={12} /> Present
                          </span>
                        );

                        return (
                          <div className="flex flex-col items-center gap-0.5">
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-red-100 text-red-700 border border-red-200 uppercase">
                              <XCircle size={12} /> Absent
                            </span>
                            {!item.attendance && !isOD && <span className="text-[8px] text-slate-400 italic">Missing Bio</span>}
                            {!hasTimesheet && <span className="text-[8px] text-slate-400 italic">Missing TS</span>}
                          </div>
                        );
                      })()}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleDownloadMonthlyReport(item)}
                          className="p-2 text-slate-400 hover:text-blue-600 transition-colors"
                          title="Download Monthly Report"
                        >
                          <Download size={16} />
                        </button>
                        <button
                          onClick={() => setSelectedEmployee(item)}
                          className="text-blue-600 hover:text-blue-800 text-sm font-medium transition-colors"
                        >
                          View
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {selectedEmployee && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4 backdrop-blur-md">
          <div className={`${isFullScreen ? 'w-screen h-screen m-0 rounded-none' : 'w-full max-w-4xl max-h-[90vh] rounded-3xl'} bg-white dark:bg-slate-900 shadow-2xl overflow-hidden border border-white/20 flex flex-col animate-in fade-in zoom-in duration-300 transition-all`}>
            {/* Header Section */}
            <div className="px-8 py-6 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 flex justify-between items-start">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-2xl bg-indigo-600 text-white flex items-center justify-center font-bold text-2xl shadow-xl shadow-indigo-500/20">
                  {selectedEmployee.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-slate-900 dark:text-white leading-tight">{selectedEmployee.name}</h2>
                  <div className="flex items-center gap-3 mt-1 text-slate-500 text-sm font-medium">
                    <span className="bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded text-[10px] uppercase tracking-wider">{selectedEmployee.department || 'Operations'}</span>
                    <span>•</span>
                    <span>{format(new Date(selectedDate), 'EEE, MMM dd, yyyy')}</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsFullScreen(!isFullScreen)}
                  className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors text-slate-400"
                  title="Toggle Fullscreen"
                >
                  {isFullScreen ? <Minimize2 size={20} /> : <Maximize2 size={20} />}
                </button>
                <button onClick={() => setSelectedEmployee(null)} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors text-slate-300 hover:text-slate-500">
                  <XCircle size={24} />
                </button>
              </div>
            </div>

            {/* Content Section */}
            <div className="flex-1 overflow-y-auto px-8 py-6 space-y-8 scrollbar-hide">

              {/* Discrepancy Warning */}
              {(() => {
                const bioMins = selectedEmployee.attendance?.minutes || 0;
                const tsMins = selectedEmployee.timesheet?.minutes || 0;
                const diff = Math.abs(bioMins - tsMins);
                // Warning if difference is more than 60 minutes
                if (diff > 60 && bioMins > 0) {
                  return (
                    <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/30 rounded-2xl flex items-center gap-3 text-red-600 dark:text-red-400">
                      <AlertTriangle size={24} />
                      <div className="text-sm">
                        <p className="font-bold">Significant Time Discrepancy Detected!</p>
                        <p className="opacity-80">
                          Biometric duration: {Math.floor(bioMins / 60)}h {bioMins % 60}m vs
                          Timesheet: {Math.floor(tsMins / 60)}h {tsMins % 60}m.
                        </p>
                      </div>
                    </div>
                  );
                }
                return null;
              })()}

              {/* Quick Stats Grid */}
              <div className="grid grid-cols-4 gap-4">
                <StatBox label="Timesheet Total" value={selectedEmployee.timesheet?.hours || '0h 0m'} sub="From TimeStrap" color="indigo" />
                <StatBox
                  label="Biometric Total"
                  value={selectedEmployee.attendance ? `${Math.floor(selectedEmployee.attendance.minutes / 60)}h ${selectedEmployee.attendance.minutes % 60}m` : '0h 0m'}
                  sub="Punch In to Out"
                  color="slate"
                />
                <StatBox
                  label="Overtime"
                  value={(() => {
                    const mins = selectedEmployee.timesheet?.minutes || 0;
                    if (mins > 480) {
                      const d = mins - 480;
                      return `${Math.floor(d / 60)}h ${d % 60}m`;
                    }
                    return '0h 0m';
                  })()}
                  sub="Beyond 8h Target"
                  color="emerald"
                />
                <StatBox label="Shift Break" value="1h 0m" sub="Daily Policy" color="amber" />
              </div>

              {/* Biometric Attendance Cards */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-slate-50 dark:bg-slate-800/40 p-4 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 flex items-center justify-center shadow-inner"><LogIn size={24} /></div>
                    <div>
                      <p className="text-[10px] uppercase tracking-widest font-black text-slate-400 mb-0.5">Physical Punch In</p>
                      <p className="text-xl font-black text-slate-800 dark:text-slate-100">
                        {selectedEmployee.attendance ? format(new Date(selectedEmployee.attendance.first_punch), 'hh:mm a') : 'No Punch'}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="bg-slate-50 dark:bg-slate-800/40 p-4 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 flex items-center justify-center shadow-inner"><LogOut size={24} /></div>
                    <div>
                      <p className="text-[10px] uppercase tracking-widest font-black text-slate-400 mb-0.5">Physical Punch Out</p>
                      <p className="text-xl font-black text-slate-800 dark:text-slate-100">
                        {selectedEmployee.attendance ? format(new Date(selectedEmployee.attendance.last_punch), 'hh:mm a') : 'No Punch'}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* TimeStrap Task Breakdown */}
              <div className="space-y-4">
                <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800 pb-3">
                  <h3 className="font-bold text-slate-800 dark:text-white flex items-center gap-2 text-lg">
                    <Clock size={20} className="text-indigo-500" /> Hourly Activity Breakdown
                  </h3>
                  <span className="text-[10px] font-black text-indigo-600 bg-indigo-50 dark:bg-indigo-900/30 px-3 py-1 rounded-full uppercase tracking-widest border border-indigo-100 dark:border-indigo-900/30">TimeStrap Integration</span>
                </div>

                <div className="space-y-3 relative">
                  <div className="absolute left-6 top-0 bottom-0 w-1 bg-slate-50 dark:bg-slate-800/50 -z-10 rounded-full"></div>

                  {selectedEmployee.timesheet?.entries?.length > 0 ? (
                    selectedEmployee.timesheet.entries.map((entry: any, idx: number) => {
                      const isExpanded = expandedTasks.includes(idx);
                      return (
                        <div key={idx} className="relative pl-14 group">
                          <div className={`absolute left-4 top-5 w-5 h-5 rounded-full border-4 ${isExpanded ? 'border-indigo-500 bg-white' : 'border-slate-200 bg-slate-50'} dark:bg-slate-900 z-10 transition-all`}></div>

                          <div className={`bg-white dark:bg-slate-800/50 rounded-2xl border ${isExpanded ? 'border-indigo-200 shadow-xl' : 'border-slate-100 dark:border-slate-800 shadow-sm'} transition-all overflow-hidden`}>
                            <button
                              onClick={() => setExpandedTasks(prev => isExpanded ? prev.filter(i => i !== idx) : [...prev, idx])}
                              className="w-full px-5 py-4 flex justify-between items-center hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors"
                            >
                              <div className="flex items-center gap-4 text-left">
                                <div className="space-y-1">
                                  <p className="text-[11px] font-black text-indigo-600 dark:text-indigo-400 uppercase tracking-widest">
                                    Project: {entry.project || 'General'}
                                  </p>
                                  <div className="text-[10px] text-slate-400 font-bold flex items-center gap-2">
                                    <Clock size={12} /> {entry.startTime} - {entry.endTime}
                                  </div>
                                </div>
                              </div>
                              <div className="flex items-center gap-4">
                                <span className="text-sm font-black text-slate-900 dark:text-white bg-slate-100 dark:bg-slate-700 px-3 py-1.5 rounded-xl">
                                  {entry.hours}
                                </span>
                                <ChevronDown size={20} className={`text-slate-300 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`} />
                              </div>
                            </button>

                            {isExpanded && (
                              <div className="px-5 pb-5 pt-2 border-t border-slate-50 dark:border-slate-800 animate-in slide-in-from-top-2 duration-300">
                                <div className="space-y-4">
                                  <div className="p-3 bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-slate-100 dark:border-slate-800">
                                    <p className="text-[10px] uppercase font-black text-slate-400 mb-1 tracking-widest">Task Description</p>
                                    <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed italic">
                                      Task: {entry.task || 'No description provided.'}
                                    </p>
                                  </div>
                                  {entry.achievements && (
                                    <div>
                                      <p className="text-[10px] uppercase font-black text-emerald-500 mb-1 tracking-widest">Achievements</p>
                                      <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400 font-medium">
                                        <CheckCircle2 size={16} />
                                        {entry.achievements}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="text-center py-12 bg-slate-50 dark:bg-slate-800/30 rounded-3xl border-2 border-dashed border-slate-100 dark:border-slate-800">
                      <Clock size={40} className="mx-auto text-slate-200 mb-3" />
                      <p className="text-slate-400 font-bold">No tasks recorded for this day.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Footer Section */}
            <div className="px-8 py-5 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/30 flex justify-between items-center">
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse"></div>
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">
                  Standard Policy: 9h Shift (1h Breaks). Target: 8h.
                </p>
              </div>
              <button
                onClick={() => setSelectedEmployee(null)}
                className="px-10 py-3 text-sm font-black text-white bg-indigo-600 hover:bg-indigo-700 rounded-2xl shadow-xl shadow-indigo-500/30 transition-all hover:-translate-y-0.5 active:translate-y-0"
              >
                Close Summary
              </button>
            </div>
          </div>
        </div>
      )}
      {showReportModal && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden border border-white/20 animate-in fade-in zoom-in duration-300">
            <div className="px-8 py-6 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50/50 dark:bg-slate-800/50">
              <div>
                <h2 className="text-xl font-bold text-slate-900 dark:text-white">Download Monthly Report</h2>
                <p className="text-slate-500 text-sm">Select details for the PDF generation</p>
              </div>
              <button
                onClick={() => setShowReportModal(false)}
                className="p-2 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full transition-colors text-slate-400"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-8 space-y-6">
              <div className="space-y-2">
                <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">Employee</label>
                <select
                  value={reportEmployeeId}
                  onChange={(e) => setReportEmployeeId(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  <option value="">Select Employee</option>
                  {employeesData.map(e => (
                    <option key={e.id} value={e.id}>{e.name}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">Month</label>
                  <select
                    value={reportMonth}
                    onChange={(e) => setReportMonth(Number(e.target.value))}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  >
                    {[...Array(12)].map((_, i) => (
                      <option key={i + 1} value={i + 1}>
                        {new Date(0, i).toLocaleString('en-US', { month: 'long' })}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">Year</label>
                  <select
                    value={reportYear}
                    onChange={(e) => setReportYear(Number(e.target.value))}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  >
                    {[2024, 2025, 2026].map(y => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="pt-4">
                <button
                  onClick={async () => {
                    await handleDownloadBySelection();
                    setShowReportModal(false);
                  }}
                  disabled={isGeneratingReport || !reportEmployeeId}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white py-4 rounded-2xl font-bold transition-all shadow-xl shadow-blue-500/20 flex items-center justify-center gap-3 disabled:opacity-50 disabled:shadow-none"
                >
                  {isGeneratingReport ? (
                    <>
                      <RefreshCw size={20} className="animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Download size={20} />
                      Download Report
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showSettings && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xl w-full max-w-md overflow-hidden border border-slate-200 dark:border-slate-700">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-800/50">
              <h2 className="text-lg font-bold text-slate-800 dark:text-white">Configure Biometric Device</h2>
              <button onClick={() => setShowSettings(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
                ✕
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Device IP Address</label>
                <input
                  type="text"
                  value={deviceIp}
                  onChange={e => setDeviceIp(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g. 192.168.1.201"
                />
                <p className="text-xs text-slate-500 mt-1 italic">
                  Note: Your computer must be on the same WiFi/Network as this IP address.
                </p>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex justify-end gap-3">
              <button
                onClick={() => setShowSettings(false)}
                className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleUpdateSettings}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FilterOption({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${active ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 font-medium' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50'}`}
    >
      {label}
    </button>
  );
}

function StatBox({ label, value, sub, color }: { label: string, value: string, sub: string, color: string }) {
  const colors: any = {
    indigo: 'bg-indigo-50 text-indigo-700 border-indigo-100 dark:bg-indigo-900/20 dark:text-indigo-300 dark:border-indigo-900/30',
    slate: 'bg-slate-50 text-slate-700 border-slate-100 dark:bg-slate-800/40 dark:text-slate-300 dark:border-slate-800',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100 dark:bg-emerald-900/20 dark:text-emerald-300 dark:border-emerald-900/30',
    amber: 'bg-amber-50 text-amber-700 border-amber-100 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-900/30',
  };

  return (
    <div className={`p-3 rounded-2xl border ${colors[color] || colors.slate}`}>
      <p className="text-[9px] uppercase tracking-widest font-black opacity-60 mb-0.5">{label}</p>
      <p className="text-lg font-black leading-none">{value}</p>
      <p className="text-[8px] mt-1 font-bold opacity-50">{sub}</p>
    </div>
  );
}

function StatCard({ label, value, icon, color }: { label: string, value: number, icon: React.ReactNode, color: 'blue' | 'green' | 'orange' | 'red' | 'purple' | 'teal' }) {
  const colorStyles = {
    blue: 'bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400 border-blue-100 dark:border-blue-900/30',
    green: 'bg-green-50 text-green-600 dark:bg-green-900/20 dark:text-green-400 border-green-100 dark:border-green-900/30',
    orange: 'bg-orange-50 text-orange-600 dark:bg-orange-900/20 dark:text-orange-400 border-orange-100 dark:border-orange-900/30',
    red: 'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400 border-red-100 dark:border-red-900/30',
    purple: 'bg-purple-50 text-purple-600 dark:bg-purple-900/20 dark:text-purple-400 border-purple-100 dark:border-purple-900/30',
    teal: 'bg-teal-50 text-teal-600 dark:bg-teal-900/20 dark:text-teal-400 border-teal-100 dark:border-teal-900/30',
  };

  return (
    <div className={`p-3 rounded-lg border ${colorStyles[color]} flex flex-col gap-2`}>
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider opacity-80">
        {icon}
        {label}
      </div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  );
}
