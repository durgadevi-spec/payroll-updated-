import { useState, FormEvent } from 'react';
import { Employee } from '../../types';
import { Input, Select } from '../ui/Input';
import { Button } from '../ui/Button';

type EmployeeFormData = Omit<Employee, 'id' | 'created_at' | 'updated_at'>;

interface EmployeeFormProps {
  initial?: Partial<Employee>;
  onSubmit: (data: EmployeeFormData) => Promise<void>;
  onCancel: () => void;
  loading?: boolean;
}

const departments = [
  { value: '', label: 'Select Department' },
  { value: 'Engineering', label: 'Engineering' },
  { value: 'Design', label: 'Design' },
  { value: 'Marketing', label: 'Marketing' },
  { value: 'Sales', label: 'Sales' },
  { value: 'HR', label: 'HR' },
  { value: 'Finance', label: 'Finance' },
  { value: 'Operations', label: 'Operations' },
  { value: 'Legal', label: 'Legal' },
];

export function EmployeeForm({ initial, onSubmit, onCancel, loading }: EmployeeFormProps) {
  const [form, setForm] = useState<EmployeeFormData>({
    name: initial?.name || '',
    email: initial?.email || '',
    salary: initial?.salary || 0,
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
  });

  const set = (field: keyof EmployeeFormData) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm(f => ({ ...f, [field]: field === 'salary' ? Number(e.target.value) : e.target.value }));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    await onSubmit(form);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">Personal Information</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input label="Full Name" value={form.name} onChange={set('name')} required placeholder="John Doe" />
          <Input label="Email" type="email" value={form.email} onChange={set('email')} required placeholder="john@company.com" />
          <Input label="Salary (₹)" type="number" value={form.salary || ''} onChange={set('salary')} required placeholder="12000" min="0" prefix="₹" />
          <Input label="Joining Date" type="date" value={form.joining_date || ''} onChange={set('joining_date')} />
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">Work Details</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Select label="Department" value={form.department} onChange={set('department')} options={departments} />
          <Input label="Designation" value={form.designation} onChange={set('designation')} placeholder="Software Engineer" />
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

      <div className="flex items-center justify-end gap-3 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={loading}>{initial?.id ? 'Update Employee' : 'Add Employee'}</Button>
      </div>
    </form>
  );
}
