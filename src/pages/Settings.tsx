import { useState, useEffect } from 'react';
import { Save, Building2, CreditCard, Shield, Mail } from 'lucide-react';
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
}

const defaultSettings: SettingsMap = {
  company_name: '', company_email: '', company_phone: '', company_address: '', company_gstin: '',
  working_days: '26', pf_rate: '12', esi_rate: '0.75', esi_limit: '21000', tax_rate: '10',
  smtp_host: '', smtp_port: '587', smtp_user: '', smtp_pass: '', smtp_from: '', payroll_date: '1',
};

export function Settings() {
  const { showToast } = useToast();
  const [settings, setSettings] = useState<SettingsMap>(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'company' | 'payroll' | 'smtp'>('company');

  useEffect(() => { loadSettings(); }, []);

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
