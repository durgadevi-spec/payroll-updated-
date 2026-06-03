import { useState, useEffect, FormEvent } from 'react';
import { Employee } from '../../types';
import { Input, Select } from '../ui/Input';
import { Button } from '../ui/Button';

type EmployeeFormData = Omit<Employee, 'id' | 'created_at' | 'updated_at'>;

interface Department {
  id: string;
  name: string;
  reporting_manager: string;
}

interface EmployeeFormProps {
  initial?: Partial<Employee>;
  onSubmit: (data: EmployeeFormData) => Promise<void>;
  onCancel: () => void;
  loading?: boolean;
}

export function EmployeeForm({ initial, onSubmit, onCancel, loading }: EmployeeFormProps) {
  const [departments, setDepartments] = useState<Department[]>([]);

  const [form, setForm] = useState<EmployeeFormData>({
    name: initial?.name || '',
    email: initial?.email || '',
    employee_code: initial?.employee_code || '',
    ctc: initial?.ctc || 0,
    reporting_manager: initial?.reporting_manager || '',
    department: initial?.department || '',
    designation: initial?.designation || '',
    joining_date: initial?.joining_date || '',
    bank_name: initial?.bank_name || '',
    bank_account: initial?.bank_account || '',
    ifsc_code: initial?.ifsc_code || '',
    pf_number: initial?.pf_number || '',
    esi_number: initial?.esi_number || '',
    uan_number: initial?.uan_number || '',
    status: initial?.status || 'active',
    use_pa_sla: initial?.use_pa_sla || false,
    pa_sla_balance: initial?.pa_sla_balance || 0,
  });

  // Load departments from API
  useEffect(() => {
    fetch('/api/departments')
      .then(r => r.ok ? r.json() : [])
      .then((data: Department[]) => setDepartments(data))
      .catch(() => {});
  }, []);

  const set = (field: keyof EmployeeFormData) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    let value: any = e.target.value;
    if (field === 'ctc' || field === 'pa_sla_balance') {
      value = Number(e.target.value);
    }
    if (field === 'use_pa_sla') {
      value = (e.target as HTMLInputElement).checked;
    }
    
    setForm(f => {
      const updated = { ...f, [field]: value };
      // Auto-fill reporting manager when department changes
      if (field === 'department') {
        const dept = departments.find(d => d.name === e.target.value);
        if (dept?.reporting_manager) {
          updated.reporting_manager = dept.reporting_manager;
        }
      }
      return updated;
    });
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    await onSubmit(form);
  };

  const deptOptions = [
    { value: '', label: 'Select Department' },
    ...departments.map(d => ({ value: d.name, label: d.name })),
  ];

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">Personal Information</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input label="Full Name" value={form.name} onChange={set('name')} required placeholder="John Doe" />
          <Input label="Email" type="email" value={form.email} onChange={set('email')} required placeholder="john@company.com" />
          <Input label="CTC/Annum (₹)" type="number" value={form.ctc || ''} onChange={set('ctc')} required placeholder="12000" min="0" prefix="₹" />
          <Input label="Joining Date" type="date" value={form.joining_date || ''} onChange={set('joining_date')} />
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">Work Details</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Select label="Department" value={form.department} onChange={set('department')} options={deptOptions} />
          <Input label="Designation" value={form.designation} onChange={set('designation')} placeholder="Software Engineer" />
          <Input
            label="Reporting Manager"
            value={form.reporting_manager}
            onChange={set('reporting_manager')}
            placeholder="Auto-filled from department"
          />
          <Input
            label="Employee Code (Biometric)"
            value={form.employee_code || ''}
            onChange={set('employee_code')}
            placeholder="e.g. E0047"
          />
          <Select
            label="Status"
            value={form.status}
            onChange={set('status')}
            options={[{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]}
          />
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">Bank Details</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input label="Bank Name" value={form.bank_name} onChange={set('bank_name')} placeholder="HDFC Bank" />
          <Input label="Account Number" value={form.bank_account} onChange={set('bank_account')} placeholder="1234567890" />
          <Input label="IFSC Code" value={form.ifsc_code} onChange={set('ifsc_code')} placeholder="HDFC0001234" />
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">Statutory Details</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Input label="PF Number" value={form.pf_number} onChange={set('pf_number')} placeholder="PF001" />
          <Input label="ESI Number" value={form.esi_number} onChange={set('esi_number')} placeholder="ESI001" />
          <Input label="UAN Number" value={form.uan_number} onChange={set('uan_number')} placeholder="UAN001" />
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">Leave Balances</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
          <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={form.use_pa_sla}
              onChange={set('use_pa_sla')}
              className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
            />
            Use PA/SLA Balance for Unpaid Leaves
          </label>
          
          {form.use_pa_sla && (
            <Input 
              label="PA/SLA Balance (Days)" 
              type="number" 
              value={form.pa_sla_balance?.toString() || '0'} 
              onChange={set('pa_sla_balance')} 
              min="0" 
              step="0.5"
            />
          )}
        </div>
      </div>

      <div className="flex items-center justify-end gap-3 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={loading}>{initial?.id ? 'Update Employee' : 'Add Employee'}</Button>
      </div>
    </form>
  );
}
