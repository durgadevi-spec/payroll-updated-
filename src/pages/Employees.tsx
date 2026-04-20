import { useState, useEffect } from 'react';
import { UserPlus, Search, Pencil, Trash2, Building2, Mail, Calendar } from 'lucide-react';
import { Employee } from '../types';
import { useToast } from '../context/ToastContext';
import { formatCurrency } from '../lib/payrollCalculator';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Modal } from '../components/ui/Modal';
import { Badge } from '../components/ui/Badge';
import { TableSkeleton } from '../components/ui/Skeleton';
import { EmployeeForm } from '../components/employees/EmployeeForm';

export function Employees() {
  const { showToast } = useToast();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [deleting, setDeleting] = useState<Employee | null>(null);
  const [saving, setSaving] = useState(false);
  const [viewEmployee, setViewEmployee] = useState<Employee | null>(null);

  useEffect(() => { loadEmployees(); }, []);

  async function loadEmployees() {
    setLoading(true);
    try {
      const response = await fetch('/api/employees');
      if (!response.ok) throw new Error('Failed to load employees');
      const data = await response.json();
      setEmployees(data || []);
    } catch (error) {
      console.error(error);
      showToast('error', 'Failed to load employees');
    }
    setLoading(false);
  }

  async function handleSave(formData: Omit<Employee, 'id' | 'created_at' | 'updated_at'>) {
    setSaving(true);
    try {
      const method = editing ? 'PUT' : 'POST';
      const url = editing ? `/api/employees/${editing.id}` : '/api/employees';
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        const message = errorBody?.error || 'Failed to save employee';
        throw new Error(message);
      }

      const savedEmployee = await response.json();
      showToast('success', `${savedEmployee.name} ${editing ? 'updated' : 'added'} successfully`);
    } catch (error) {
      console.error(error);
      showToast('error', String(error.message || 'Failed to save employee'));
    }
    setSaving(false);
    setShowForm(false);
    setEditing(null);
    await loadEmployees();
  }

  async function handleDelete() {
    if (!deleting) return;
    try {
      const response = await fetch(`/api/employees/${deleting.id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Failed to delete employee');
      showToast('success', `${deleting.name} removed`);
    } catch (error) {
      console.error(error);
      showToast('error', 'Failed to delete employee');
    }
    setDeleting(null);
    await loadEmployees();
  }

  const filtered = employees.filter(e => {
    const matchSearch = !search || e.name.toLowerCase().includes(search.toLowerCase()) || e.email.toLowerCase().includes(search.toLowerCase()) || e.department?.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'all' || e.status === statusFilter;
    return matchSearch && matchStatus;
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1 relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, email, department..."
            className="w-full pl-9 pr-4 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
          />
        </div>
        <div className="flex items-center gap-2">
          {(['all', 'active', 'inactive'] as const).map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors capitalize ${statusFilter === s ? 'bg-blue-600 text-white' : 'bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'}`}
            >
              {s}
            </button>
          ))}
        </div>
        <Button icon={<UserPlus size={16} />} onClick={() => { setEditing(null); setShowForm(true); }}>
          Add Employee
        </Button>
      </div>

      <Card padding={false}>
        <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
          <div>
            <p className="font-semibold text-slate-800 dark:text-white text-sm">All Employees</p>
            <p className="text-slate-400 text-xs mt-0.5">{filtered.length} of {employees.length} employees</p>
          </div>
        </div>

        <div className="overflow-x-auto">
          {loading ? (
            <div className="p-5"><TableSkeleton rows={5} cols={6} /></div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center">
              <Building2 size={36} className="mx-auto text-slate-300 dark:text-slate-600 mb-3" />
              <p className="text-slate-500 dark:text-slate-400 text-sm">No employees found</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-700">
                  {['Employee', 'Department', 'Salary', 'Joining Date', 'Status', 'Actions'].map(h => (
                    <th key={h} className={`py-3 px-4 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider ${h === 'Actions' ? 'text-right' : 'text-left'} ${['Department', 'Joining Date'].includes(h) ? 'hidden md:table-cell' : ''}`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(emp => (
                  <tr key={emp.id} className="border-b border-slate-50 dark:border-slate-700/30 hover:bg-slate-50/50 dark:hover:bg-slate-700/20 transition-colors group">
                    <td className="py-3 px-4">
                      <button onClick={() => setViewEmployee(emp)} className="flex items-center gap-3 text-left">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                          {emp.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="font-medium text-slate-700 dark:text-slate-200 text-xs hover:text-blue-600 dark:hover:text-blue-400 transition-colors">{emp.name}</p>
                          <p className="text-slate-400 text-xs">{emp.email}</p>
                        </div>
                      </button>
                    </td>
                    <td className="py-3 px-4 hidden md:table-cell">
                      <div>
                        <p className="text-xs text-slate-600 dark:text-slate-300">{emp.department || '—'}</p>
                        <p className="text-xs text-slate-400">{emp.designation || '—'}</p>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <span className="font-semibold text-slate-700 dark:text-slate-200 text-xs">{formatCurrency(emp.salary)}</span>
                    </td>
                    <td className="py-3 px-4 hidden md:table-cell">
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        {emp.joining_date ? new Date(emp.joining_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <Badge variant={emp.status === 'active' ? 'success' : 'neutral'} dot>
                        {emp.status}
                      </Badge>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => { setEditing(emp); setShowForm(true); }}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => setDeleting(emp)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors"
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
        isOpen={showForm}
        onClose={() => { setShowForm(false); setEditing(null); }}
        title={editing ? 'Edit Employee' : 'Add New Employee'}
        subtitle={editing ? `Editing ${editing.name}` : 'Fill in the employee details below'}
        size="lg"
      >
        <EmployeeForm
          initial={editing || undefined}
          onSubmit={handleSave}
          onCancel={() => { setShowForm(false); setEditing(null); }}
          loading={saving}
        />
      </Modal>

      <Modal
        isOpen={!!deleting}
        onClose={() => setDeleting(null)}
        title="Delete Employee"
        size="sm"
        footer={
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setDeleting(null)}>Cancel</Button>
            <Button variant="danger" onClick={handleDelete}>Delete</Button>
          </div>
        }
      >
        <p className="text-slate-600 dark:text-slate-300 text-sm">
          Are you sure you want to delete <span className="font-semibold">{deleting?.name}</span>? This action cannot be undone and will remove all associated payroll data.
        </p>
      </Modal>

      <Modal
        isOpen={!!viewEmployee}
        onClose={() => setViewEmployee(null)}
        title="Employee Profile"
        subtitle={viewEmployee?.designation || ''}
        size="md"
      >
        {viewEmployee && (
          <div className="space-y-5">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white text-xl font-bold">
                {viewEmployee.name.charAt(0).toUpperCase()}
              </div>
              <div>
                <h3 className="font-bold text-slate-800 dark:text-white text-lg">{viewEmployee.name}</h3>
                <p className="text-slate-500 text-sm">{viewEmployee.designation}</p>
                <Badge variant={viewEmployee.status === 'active' ? 'success' : 'neutral'} dot>{viewEmployee.status}</Badge>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {[
                { icon: <Mail size={14} />, label: 'Email', value: viewEmployee.email },
                { icon: <Building2 size={14} />, label: 'Department', value: viewEmployee.department || '—' },
                { icon: <Calendar size={14} />, label: 'Joining Date', value: viewEmployee.joining_date ? new Date(viewEmployee.joining_date).toLocaleDateString('en-IN') : '—' },
                { label: 'Salary', value: formatCurrency(viewEmployee.salary) },
                { label: 'PF Number', value: viewEmployee.pf_number || '—' },
                { label: 'UAN Number', value: viewEmployee.uan_number || '—' },
                { label: 'Bank', value: viewEmployee.bank_name || '—' },
                { label: 'Account', value: viewEmployee.bank_account || '—' },
              ].map(item => (
                <div key={item.label} className="p-3 bg-slate-50 dark:bg-slate-700/50 rounded-lg">
                  <p className="text-xs text-slate-400 mb-0.5">{item.label}</p>
                  <p className="text-xs font-medium text-slate-700 dark:text-slate-200">{item.value}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
