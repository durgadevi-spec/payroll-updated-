import React, { useState, useEffect } from 'react';
import { 
  Banknote, 
  Plus, 
  Search, 
  Filter, 
  MoreVertical, 
  CheckCircle2, 
  Clock, 
  Edit, 
  Trash2,
  AlertCircle
} from 'lucide-react';
import { format } from 'date-fns';

export function AdvanceManagement() {
  const [showAddModal, setShowAddModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  
  const [advances, setAdvances] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  
  const [formData, setFormData] = useState({
    employee_id: '',
    amount: '',
    date: format(new Date(), 'yyyy-MM-dd'),
    reason: '',
    repayment_type: 'Monthly',
    installment_amount: '',
    remarks: ''
  });

  useEffect(() => {
    fetchAdvances();
    fetchEmployees();
  }, []);

  async function fetchAdvances() {
    setLoading(true);
    try {
      const res = await fetch('/api/advances');
      if (res.ok) setAdvances(await res.json());
    } catch (e) { console.error(e); }
    setLoading(false);
  }

  async function fetchEmployees() {
    try {
      const res = await fetch('/api/employees');
      if (res.ok) setEmployees(await res.json());
    } catch (e) { console.error(e); }
  }

  async function handleSubmit() {
    if (!formData.employee_id || !formData.amount) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/advances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });
      if (res.ok) {
        setShowAddModal(false);
        setFormData({ ...formData, amount: '', reason: '', installment_amount: '', remarks: '' });
        fetchAdvances();
      }
    } catch (e) { console.error(e); }
    setSubmitting(false);
  }

  const activeAdvances = advances.filter(a => a.status === 'Active');
  const totalAdvances = activeAdvances.reduce((sum, a) => sum + Number(a.balance), 0);
  const expectedMonthly = activeAdvances.reduce((sum, a) => sum + Number(a.installment_amount), 0);
  const recoveredAmount = advances.reduce((sum, a) => sum + (Number(a.amount) - Number(a.balance)), 0);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Advance Management</h1>
          <p className="text-slate-500 text-sm mt-1">Manage employee salary advances and deductions</p>
        </div>
        <button 
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors shadow-sm"
        >
          <Plus size={16} />
          New Advance
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard label="Total Active Advances" value={`₹${totalAdvances.toLocaleString()}`} subValue={`${activeAdvances.length} Employees`} icon={<Banknote size={20} />} color="blue" />
        <StatCard label="Monthly Deduction" value={`₹${expectedMonthly.toLocaleString()}`} subValue="Expected this month" icon={<Clock size={20} />} color="orange" />
        <StatCard label="Recovered Amount" value={`₹${recoveredAmount.toLocaleString()}`} subValue="Total recovered" icon={<CheckCircle2 size={20} />} color="green" />
        <StatCard label="Pending Balance" value={`₹${totalAdvances.toLocaleString()}`} subValue="Across all employees" icon={<AlertCircle size={20} />} color="purple" />
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-slate-50 dark:bg-slate-800/50">
          <h3 className="font-semibold text-slate-800 dark:text-white">All Advances</h3>
          <div className="flex items-center gap-3 w-full sm:w-auto">
            <div className="relative flex-1 sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input 
                type="text"
                placeholder="Search employees..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-sm focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <button className="p-2 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 rounded-lg text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-700">
              <Filter size={16} />
            </button>
          </div>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-50 dark:bg-slate-800/80 text-slate-500 dark:text-slate-400 uppercase text-xs">
              <tr>
                <th className="px-6 py-4 font-medium">Employee</th>
                <th className="px-6 py-4 font-medium">Date & Reason</th>
                <th className="px-6 py-4 font-medium">Amount Info</th>
                <th className="px-6 py-4 font-medium">Repayment</th>
                <th className="px-6 py-4 font-medium">Status</th>
                <th className="px-6 py-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {loading ? (
                <tr><td colSpan={6} className="px-6 py-8 text-center text-slate-500">Loading advances...</td></tr>
              ) : advances.length === 0 ? (
                <tr><td colSpan={6} className="px-6 py-8 text-center text-slate-500">No advances found</td></tr>
              ) : advances.filter(a => !searchQuery || a.employee_name?.toLowerCase().includes(searchQuery.toLowerCase())).map((adv) => (
                <tr key={adv.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 flex items-center justify-center font-bold text-xs">
                        {adv.employee_name?.charAt(0).toUpperCase() || '?'}
                      </div>
                      <div>
                        <div className="font-medium text-slate-900 dark:text-white">{adv.employee_name}</div>
                        <div className="text-xs text-slate-500">{adv.department || '—'}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-slate-900 dark:text-white">{format(new Date(adv.date), 'MMM dd, yyyy')}</div>
                    <div className="text-xs text-slate-500">{adv.reason || '—'}</div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="font-medium text-slate-900 dark:text-white">₹{Number(adv.amount).toLocaleString()}</div>
                    <div className="text-xs text-slate-500">Balance: <span className="font-medium text-blue-600 dark:text-blue-400">₹{Number(adv.balance).toLocaleString()}</span></div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-slate-900 dark:text-white">{adv.repayment_type}</div>
                    <div className="text-xs text-slate-500">₹{Number(adv.installment_amount).toLocaleString()} / mo</div>
                  </td>
                  <td className="px-6 py-4">
                    {adv.status === 'Active' ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border border-blue-200 dark:border-blue-800">
                        Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                        Closed
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-md transition-colors">
                        <Edit size={16} />
                      </button>
                      <button className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md transition-colors">
                        <Trash2 size={16} />
                      </button>
                      <button className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-md transition-colors">
                        <MoreVertical size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Advance Modal (Mock) */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xl w-full max-w-2xl overflow-hidden border border-slate-200 dark:border-slate-700">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center">
              <h2 className="text-xl font-bold text-slate-800 dark:text-white">New Advance Entry</h2>
              <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
                <MoreVertical size={20} className="rotate-45" /> {/* Close icon approximation */}
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Employee</label>
                  <select 
                    value={formData.employee_id}
                    onChange={e => setFormData({...formData, employee_id: e.target.value})}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Select Employee</option>
                    {employees.map(emp => (
                      <option key={emp.id} value={emp.id}>{emp.name} ({emp.department || 'No Dept'})</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Advance Amount</label>
                  <input 
                    type="number" 
                    value={formData.amount}
                    onChange={e => setFormData({...formData, amount: e.target.value})}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm focus:ring-2 focus:ring-blue-500" 
                    placeholder="₹" 
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Date</label>
                  <input 
                    type="date" 
                    value={formData.date}
                    onChange={e => setFormData({...formData, date: e.target.value})}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm focus:ring-2 focus:ring-blue-500" 
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Repayment Type</label>
                  <select 
                    value={formData.repayment_type}
                    onChange={e => setFormData({...formData, repayment_type: e.target.value})}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="Monthly">Monthly Deduction</option>
                    <option value="One-time">One-time Deduction</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Installment Amount</label>
                  <input 
                    type="number" 
                    value={formData.installment_amount}
                    onChange={e => setFormData({...formData, installment_amount: e.target.value})}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm focus:ring-2 focus:ring-blue-500" 
                    placeholder="₹ per month" 
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Reason</label>
                  <input 
                    type="text" 
                    value={formData.reason}
                    onChange={e => setFormData({...formData, reason: e.target.value})}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm focus:ring-2 focus:ring-blue-500" 
                    placeholder="E.g., Medical Emergency" 
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Remarks</label>
                <textarea 
                  rows={3} 
                  value={formData.remarks}
                  onChange={e => setFormData({...formData, remarks: e.target.value})}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm focus:ring-2 focus:ring-blue-500" 
                  placeholder="Any additional details..."
                />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex justify-end gap-3">
              <button 
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={handleSubmit}
                disabled={submitting || !formData.employee_id || !formData.amount}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
              >
                {submitting ? 'Saving...' : 'Save Advance'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, subValue, icon, color }: { label: string, value: string, subValue: string, icon: React.ReactNode, color: 'blue' | 'green' | 'orange' | 'purple' }) {
  const colorStyles = {
    blue: 'bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400 border-blue-100 dark:border-blue-900/30',
    green: 'bg-green-50 text-green-600 dark:bg-green-900/20 dark:text-green-400 border-green-100 dark:border-green-900/30',
    orange: 'bg-orange-50 text-orange-600 dark:bg-orange-900/20 dark:text-orange-400 border-orange-100 dark:border-orange-900/30',
    purple: 'bg-purple-50 text-purple-600 dark:bg-purple-900/20 dark:text-purple-400 border-purple-100 dark:border-purple-900/30',
  };

  return (
    <div className={`p-4 rounded-xl border ${colorStyles[color]} flex flex-col gap-3`}>
      <div className="flex items-center gap-2 text-sm font-medium opacity-80">
        {icon}
        {label}
      </div>
      <div>
        <div className="text-2xl font-bold text-slate-900 dark:text-white">{value}</div>
        <div className="text-xs mt-1 opacity-70">{subValue}</div>
      </div>
    </div>
  );
}
