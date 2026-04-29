import { useState, useEffect } from 'react';
import { Save, Building2, CreditCard, Shield, Mail, Users2, Pencil, Trash2, Plus, X, Check, Bell, Calendar } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useToast } from '../context/ToastContext';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';

interface SettingsMap {
  company_name: string;
  company_email: string;
  company_phone: string;
  company_address: string;
  company_gstin: string;
  working_days: string;
  pf_rate: string;
  esi_rate: string;
  esi_limit: string;
  tax_rate: string;
  smtp_host: string;
  smtp_port: string;
  smtp_user: string;
  smtp_from: string;
  smtp_pass: string;
  payroll_date: string;
  alert_admin_emails: string;
  alert_hr_emails: string;
}

interface Department {
  id: string;
  name: string;
  reporting_manager: string;
}

interface Holiday {
  id: string;
  date: string;
  name: string;
}

const defaultSettings: SettingsMap = {
  company_name: '', company_email: '', company_phone: '', company_address: '', company_gstin: '',
  working_days: '26', pf_rate: '12', esi_rate: '0.75', esi_limit: '21000', tax_rate: '10',
  smtp_host: '', smtp_port: '587', smtp_user: '', smtp_pass: '', smtp_from: '', payroll_date: '1',
  alert_admin_emails: 'sp@ctint.in,durgadevi@ctint.in',
  alert_hr_emails: 'pushpa.p@ctint.in',
};

export function Settings() {
  const { showToast } = useToast();
  const [settings, setSettings] = useState<SettingsMap>(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'company' | 'payroll' | 'smtp' | 'departments' | 'holidays'>('company');

  // Department state
  const [departments, setDepartments] = useState<Department[]>([]);
  const [deptLoading, setDeptLoading] = useState(false);
  const [editingDept, setEditingDept] = useState<Department | null>(null);
  const [newDept, setNewDept] = useState({ name: '', reporting_manager: '' });
  const [showAddDept, setShowAddDept] = useState(false);
  const [deptSaving, setDeptSaving] = useState(false);

  // Holiday state
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [holidayLoading, setHolidayLoading] = useState(false);
  const [newHoliday, setNewHoliday] = useState({ date: '', name: '' });
  const [showAddHoliday, setShowAddHoliday] = useState(false);
  const [holidaySaving, setHolidaySaving] = useState(false);

  useEffect(() => { loadSettings(); }, []);
  useEffect(() => { if (activeTab === 'departments') loadDepartments(); }, [activeTab]);
  useEffect(() => { if (activeTab === 'holidays') loadHolidays(); }, [activeTab]);

  async function loadHolidays() {
    setHolidayLoading(true);
    try {
      const res = await fetch('/api/holidays');
      if (res.ok) setHolidays(await res.json());
    } catch (e) { console.error(e); }
    setHolidayLoading(false);
  }

  async function handleAddHoliday() {
    if (!newHoliday.date || !newHoliday.name.trim()) return showToast('error', 'Date and name are required');
    setHolidaySaving(true);
    try {
      const res = await fetch('/api/holidays', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newHoliday),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      showToast('success', `Holiday "${newHoliday.name}" added`);
      setNewHoliday({ date: '', name: '' });
      setShowAddHoliday(false);
      await loadHolidays();
    } catch (e: any) { showToast('error', e.message || 'Failed to add holiday'); }
    setHolidaySaving(false);
  }

  async function handleDeleteHoliday(holiday: Holiday) {
    if (!confirm(`Delete holiday "${holiday.name}"?`)) return;
    try {
      const res = await fetch(`/api/holidays/${holiday.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete');
      showToast('success', `Holiday "${holiday.name}" deleted`);
      await loadHolidays();
    } catch (e) { showToast('error', 'Failed to delete holiday'); }
  }

  async function loadDepartments() {
    setDeptLoading(true);
    try {
      const res = await fetch('/api/departments');
      if (res.ok) setDepartments(await res.json());
    } catch (e) { console.error(e); }
    setDeptLoading(false);
  }

  async function handleAddDept() {
    if (!newDept.name.trim()) return showToast('error', 'Department name is required');
    setDeptSaving(true);
    try {
      const res = await fetch('/api/departments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newDept),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      showToast('success', `Department "${newDept.name}" created`);
      setNewDept({ name: '', reporting_manager: '' });
      setShowAddDept(false);
      await loadDepartments();
    } catch (e: any) { showToast('error', e.message || 'Failed to create department'); }
    setDeptSaving(false);
  }

  async function handleUpdateDept() {
    if (!editingDept || !editingDept.name.trim()) return;
    setDeptSaving(true);
    try {
      const res = await fetch(`/api/departments/${editingDept.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editingDept.name, reporting_manager: editingDept.reporting_manager }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      showToast('success', 'Department updated');
      setEditingDept(null);
      await loadDepartments();
    } catch (e: any) { showToast('error', e.message || 'Failed to update department'); }
    setDeptSaving(false);
  }

  async function handleDeleteDept(dept: Department) {
    if (!confirm(`Delete department "${dept.name}"? This won't affect existing employees.`)) return;
    try {
      const res = await fetch(`/api/departments/${dept.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete');
      showToast('success', `Department "${dept.name}" deleted`);
      await loadDepartments();
    } catch (e) { showToast('error', 'Failed to delete department'); }
  }

  async function loadSettings() {
    setLoading(true);
    const { data } = await supabase.from('settings').select('*');
    if (data) {
      const map: Partial<SettingsMap> = {};
      data.forEach(s => { (map as Record<string, string>)[s.key] = s.value || ''; });
      setSettings(prev => ({ ...prev, ...map }));
    }
    setLoading(false);
  }

  async function saveSettings() {
    setSaving(true);
    const upserts = Object.entries(settings).map(([key, value]) => ({
      key, value, updated_at: new Date().toISOString(),
    }));
    const { error } = await supabase.from('settings').upsert(upserts, { onConflict: 'key' });
    if (error) showToast('error', 'Failed to save settings');
    else {
      showToast('success', 'Settings saved successfully');
      await supabase.from('audit_logs').insert({ action: 'UPDATE_SETTINGS', entity: 'settings', details: { tab: activeTab } });
    }
    setSaving(false);
  }

  const set = (key: keyof SettingsMap) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setSettings(prev => ({ ...prev, [key]: e.target.value }));
  };

  const tabs = [
    { id: 'company' as const, label: 'Company', icon: <Building2 size={15} /> },
    { id: 'payroll' as const, label: 'Payroll Rules', icon: <CreditCard size={15} /> },
    { id: 'smtp' as const, label: 'Email / SMTP', icon: <Mail size={15} /> },
    { id: 'departments' as const, label: 'Departments', icon: <Users2 size={15} /> },
    { id: 'holidays' as const, label: 'Holidays', icon: <Calendar size={15} /> },
  ];

  if (loading) {
    return (
      <div className="space-y-5">
        <Card>
          <div className="animate-pulse space-y-4">
            {[1, 2, 3, 4].map(i => <div key={i} className="h-10 bg-slate-200 dark:bg-slate-700 rounded" />)}
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-center justify-between">
        <p className="text-slate-500 dark:text-slate-400 text-sm">Configure system preferences and integrations</p>
        <Button icon={<Save size={15} />} loading={saving} onClick={saveSettings}>
          Save Changes
        </Button>
      </div>

      <Card padding={false}>
        <div className="flex border-b border-slate-200 dark:border-slate-700">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-5 py-3.5 text-sm font-medium transition-colors border-b-2 ${
                activeTab === tab.id
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
              }`}
            >
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>

        <div className="p-6 space-y-5">
          {activeTab === 'company' && (
            <>
              <SectionHeader icon={<Building2 size={16} />} title="Company Information" desc="Basic company details used in payslips and reports" />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input label="Company Name" value={settings.company_name} onChange={set('company_name')} />
                <Input label="Company Email" type="email" value={settings.company_email} onChange={set('company_email')} />
                <Input label="Phone" value={settings.company_phone} onChange={set('company_phone')} />
                <Input label="GSTIN" value={settings.company_gstin} onChange={set('company_gstin')} />
              </div>
              <Input label="Address" value={settings.company_address} onChange={set('company_address')} />

              {/* ── Nightly Alert Recipients ── */}
              <div className="pt-2 border-t border-slate-100 dark:border-slate-700">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-7 h-7 rounded-lg bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                    <Bell size={14} className="text-amber-600 dark:text-amber-400" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">Nightly Alert Recipients</p>
                    <p className="text-[10px] text-slate-400">Emails sent at 12:00 AM — missing timesheets, absences, payroll reminders &amp; discrepancies</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Input
                    label="Admin Emails"
                    value={settings.alert_admin_emails}
                    onChange={set('alert_admin_emails')}
                    placeholder="sp@ctint.in,durgadevi@ctint.in"
                    hint="Comma-separated. Receives all alerts."
                  />
                  <Input
                    label="HR Email"
                    value={settings.alert_hr_emails}
                    onChange={set('alert_hr_emails')}
                    placeholder="pushpa.p@ctint.in"
                    hint="Comma-separated. Receives all alerts."
                  />
                </div>
              </div>
            </>
          )}

          {activeTab === 'payroll' && (
            <>
              <SectionHeader icon={<Shield size={16} />} title="Payroll Rules" desc="Statutory deduction rates and working day settings" />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input label="Working Days per Month" type="number" value={settings.working_days} onChange={set('working_days')} hint="Standard working days used for per-day salary calculation" />
                <Input label="Payroll Date" type="number" value={settings.payroll_date} onChange={set('payroll_date')} hint="Day of month for payroll processing" min="1" max="31" />
                <Input label="PF Rate (%)" type="number" value={settings.pf_rate} onChange={set('pf_rate')} hint="Employee Provident Fund deduction rate" />
                <Input label="ESI Rate (%)" type="number" value={settings.esi_rate} onChange={set('esi_rate')} hint="Employee State Insurance deduction rate" />
                <Input label="ESI Salary Limit (₹)" type="number" value={settings.esi_limit} onChange={set('esi_limit')} hint="ESI applies only if salary is below this limit" prefix="₹" />
                <Input label="Income Tax Rate (%)" type="number" value={settings.tax_rate} onChange={set('tax_rate')} hint="Flat income tax deduction rate" />
              </div>
            </>
          )}

          {activeTab === 'smtp' && (
            <>
              <SectionHeader icon={<Mail size={16} />} title="Email Configuration" desc="SMTP settings for sending payslips via email" />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input label="SMTP Host" value={settings.smtp_host} onChange={set('smtp_host')} placeholder="smtp.gmail.com" />
                <Input label="SMTP Port" value={settings.smtp_port} onChange={set('smtp_port')} placeholder="587" />
                <Input label="SMTP Username" value={settings.smtp_user} onChange={set('smtp_user')} placeholder="hr@company.com" />
                <Input label="SMTP Password" type="password" value={settings.smtp_pass} onChange={set('smtp_pass')} placeholder="••••••••" />
                <Input label="From Address" value={settings.smtp_from} onChange={set('smtp_from')} placeholder="HR Department <hr@company.com>" />
              </div>
              <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
                <p className="text-amber-700 dark:text-amber-300 text-xs">
                  SMTP credentials are stored securely. Email sending is simulated in the demo environment.
                </p>
              </div>
            </>
          )}

          {activeTab === 'departments' && (
            <>
              <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-700">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center text-indigo-600 dark:text-indigo-400 flex-shrink-0">
                    <Users2 size={16} />
                  </div>
                  <div>
                    <p className="font-semibold text-slate-800 dark:text-white text-sm">Department Management</p>
                    <p className="text-slate-400 text-xs mt-0.5">Create departments and assign reporting managers. These appear in the employee form.</p>
                  </div>
                </div>
                <button
                  onClick={() => { setShowAddDept(true); setEditingDept(null); }}
                  className="flex items-center gap-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg transition-colors"
                >
                  <Plus size={14} /> Add Department
                </button>
              </div>

              {/* Add new department form */}
              {showAddDept && (
                <div className="p-4 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-xl space-y-3">
                  <p className="text-xs font-bold text-indigo-700 dark:text-indigo-300 uppercase tracking-wider">New Department</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Department Name <span className="text-red-500">*</span></label>
                      <input
                        type="text"
                        value={newDept.name}
                        onChange={e => setNewDept(p => ({ ...p, name: e.target.value }))}
                        placeholder="e.g. Engineering"
                        className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Reporting Manager</label>
                      <input
                        type="text"
                        value={newDept.reporting_manager}
                        onChange={e => setNewDept(p => ({ ...p, reporting_manager: e.target.value }))}
                        placeholder="e.g. Ravi Kumar"
                        className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                      />
                    </div>
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => { setShowAddDept(false); setNewDept({ name: '', reporting_manager: '' }); }} className="px-3 py-1.5 text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 font-medium rounded-lg transition-colors">
                      Cancel
                    </button>
                    <button onClick={handleAddDept} disabled={deptSaving} className="flex items-center gap-1.5 px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-50">
                      <Check size={13} /> {deptSaving ? 'Saving...' : 'Save Department'}
                    </button>
                  </div>
                </div>
              )}

              {/* Department list */}
              {deptLoading ? (
                <div className="space-y-2">
                  {[1,2,3].map(i => <div key={i} className="h-14 bg-slate-100 dark:bg-slate-700 rounded-xl animate-pulse" />)}
                </div>
              ) : departments.length === 0 ? (
                <div className="text-center py-10 text-slate-400 text-sm">
                  No departments yet. Click "Add Department" to create one.
                </div>
              ) : (
                <div className="space-y-2">
                  {departments.map(dept => (
                    <div key={dept.id} className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                      {editingDept?.id === dept.id ? (
                        // Inline edit
                        <div className="p-3 bg-slate-50 dark:bg-slate-800/50 space-y-2">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <input
                              type="text"
                              value={editingDept.name}
                              onChange={e => setEditingDept(p => p ? { ...p, name: e.target.value } : p)}
                              className="w-full px-3 py-2 text-sm border border-indigo-300 dark:border-indigo-700 rounded-lg bg-white dark:bg-slate-800 focus:ring-2 focus:ring-indigo-500 outline-none font-medium"
                            />
                            <input
                              type="text"
                              value={editingDept.reporting_manager}
                              onChange={e => setEditingDept(p => p ? { ...p, reporting_manager: e.target.value } : p)}
                              placeholder="Reporting Manager"
                              className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 focus:ring-2 focus:ring-indigo-500 outline-none"
                            />
                          </div>
                          <div className="flex gap-2 justify-end">
                            <button onClick={() => setEditingDept(null)} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"><X size={14} /></button>
                            <button onClick={handleUpdateDept} disabled={deptSaving} className="flex items-center gap-1 px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-50">
                              <Check size={13} /> {deptSaving ? 'Saving...' : 'Update'}
                            </button>
                          </div>
                        </div>
                      ) : (
                        // Display row
                        <div className="flex items-center justify-between px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center">
                              <Building2 size={15} className="text-indigo-600 dark:text-indigo-400" />
                            </div>
                            <div>
                              <p className="text-sm font-semibold text-slate-800 dark:text-white">{dept.name}</p>
                              <p className="text-xs text-slate-400">
                                {dept.reporting_manager ? `Manager: ${dept.reporting_manager}` : <span className="italic">No manager assigned</span>}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => setEditingDept(dept)}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-colors"
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              onClick={() => handleDeleteDept(dept)}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {activeTab === 'holidays' && (
            <>
              <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-700">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-rose-100 dark:bg-rose-900/30 flex items-center justify-center text-rose-600 dark:text-rose-400 flex-shrink-0">
                    <Calendar size={16} />
                  </div>
                  <div>
                    <p className="font-semibold text-slate-800 dark:text-white text-sm">Holiday Management</p>
                    <p className="text-slate-400 text-xs mt-0.5">Manage government holidays. Nightly alerts will be skipped on these days.</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowAddHoliday(true)}
                  className="flex items-center gap-2 px-3 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold rounded-lg transition-colors"
                >
                  <Plus size={14} /> Add Holiday
                </button>
              </div>

              {/* Add new holiday form */}
              {showAddHoliday && (
                <div className="p-4 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-xl space-y-3">
                  <p className="text-xs font-bold text-rose-700 dark:text-rose-300 uppercase tracking-wider">New Holiday</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Date <span className="text-red-500">*</span></label>
                      <input
                        type="date"
                        value={newHoliday.date}
                        onChange={e => setNewHoliday(p => ({ ...p, date: e.target.value }))}
                        className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 focus:ring-2 focus:ring-rose-500 focus:border-rose-500 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Holiday Name <span className="text-red-500">*</span></label>
                      <input
                        type="text"
                        value={newHoliday.name}
                        onChange={e => setNewHoliday(p => ({ ...p, name: e.target.value }))}
                        placeholder="e.g. Independence Day"
                        className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 focus:ring-2 focus:ring-rose-500 focus:border-rose-500 outline-none"
                      />
                    </div>
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => { setShowAddHoliday(false); setNewHoliday({ date: '', name: '' }); }} className="px-3 py-1.5 text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 font-medium rounded-lg transition-colors">
                      Cancel
                    </button>
                    <button onClick={handleAddHoliday} disabled={holidaySaving} className="flex items-center gap-1.5 px-4 py-1.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-50">
                      <Check size={13} /> {holidaySaving ? 'Adding...' : 'Save Holiday'}
                    </button>
                  </div>
                </div>
              )}

              {/* Holiday list */}
              {holidayLoading ? (
                <div className="space-y-2">
                  {[1,2,3].map(i => <div key={i} className="h-14 bg-slate-100 dark:bg-slate-700 rounded-xl animate-pulse" />)}
                </div>
              ) : holidays.length === 0 ? (
                <div className="text-center py-10 text-slate-400 text-sm">
                  No holidays added yet. Click "Add Holiday" to create one.
                </div>
              ) : (
                <div className="space-y-2">
                  {holidays.map(holiday => (
                    <div key={holiday.id} className="flex items-center justify-between px-4 py-3 border border-slate-200 dark:border-slate-700 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-rose-100 dark:bg-rose-900/30 flex items-center justify-center">
                          <Calendar size={15} className="text-rose-600 dark:text-rose-400" />
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-slate-800 dark:text-white">{holiday.name}</p>
                          <p className="text-xs text-slate-400">
                            {new Date(holiday.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() => handleDeleteHoliday(holiday)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </Card>
    </div>
  );
}

function SectionHeader({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="flex items-start gap-3 pb-4 border-b border-slate-100 dark:border-slate-700">
      <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400 flex-shrink-0">
        {icon}
      </div>
      <div>
        <p className="font-semibold text-slate-800 dark:text-white text-sm">{title}</p>
        <p className="text-slate-400 text-xs mt-0.5">{desc}</p>
      </div>
    </div>
  );
}
