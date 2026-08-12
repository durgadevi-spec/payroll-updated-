import React, { useState, useEffect } from 'react';
import {
  Banknote, Search, Hourglass, History, UserPlus, X
} from 'lucide-react';
import { format } from 'date-fns';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';

const ADVANCE_TYPES = ['Salary Advance', 'Medical', 'Travel', 'Education', 'Emergency', 'Festival', 'Other'];

type StatusTab = 'All' | 'Pending Approval' | 'Active' | 'Closed' | 'Rejected';

export function MyAdvances() {
  

  
  const [advances, setAdvances] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<StatusTab>('All');
  const [searchQuery, setSearchQuery] = useState('');
  
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [requestSubmitting, setRequestSubmitting] = useState(false);
  const [requestForm, setRequestForm] = useState({
    amount: '',
    date: format(new Date(), 'yyyy-MM-dd'),
    advance_type: 'Salary Advance',
    reason: '',
    repayment_type: 'Monthly',
    no_of_installments: '1',
    remarks: ''
  });

  useEffect(() => {
    fetchAdvances();
  }, []);

  async function fetchAdvances() {
    setLoading(true);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const res = await fetch('/api/me/advances', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setAdvances(data);
      }
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  }

  async function handleRequestSubmit(e: React.FormEvent) {
    e.preventDefault();
    setRequestSubmitting(true);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const res = await fetch('/api/me/advances/request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(requestForm)
      });
      if (res.ok) {
        setShowRequestModal(false);
        setRequestForm({
          amount: '',
          date: format(new Date(), 'yyyy-MM-dd'),
          advance_type: 'Salary Advance',
          reason: '',
          repayment_type: 'Monthly',
          no_of_installments: '1',
          remarks: ''
        });
        fetchAdvances();
      }
    } catch (e) {
      console.error(e);
    }
    setRequestSubmitting(false);
  }

  const activeAdvances = advances.filter(a => a.status === 'Active');
  const pendingAdvances = advances.filter(a => a.status === 'Pending Approval');
  const totalAdvances = activeAdvances.reduce((sum, a) => sum + Number(a.balance), 0);
  const expectedMonthly = activeAdvances.reduce((sum, a) => sum + Number(a.installment_amount), 0);
  const recoveredAmount = advances.reduce((sum, a) => sum + (Number(a.amount) - Number(a.balance)), 0);
  const pendingRequestAmount = pendingAdvances.reduce((sum, a) => sum + Number(a.amount), 0);

  const tabCounts: Record<StatusTab, number> = {
    'All': advances.length,
    'Pending Approval': advances.filter(a => a.status === 'Pending Approval').length,
    'Active': advances.filter(a => a.status === 'Active').length,
    'Closed': advances.filter(a => a.status === 'Closed').length,
    'Rejected': advances.filter(a => a.status === 'Rejected').length,
  };

  const visibleAdvances = advances
    .filter(a => activeTab === 'All' || a.status === activeTab)
    .filter(a => !searchQuery || (a.reason || '').toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">My Advances</h1>
          <p className="text-slate-500 text-sm mt-1">Manage your salary advances and requests</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowRequestModal(true)}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors shadow-sm"
          >
            <UserPlus size={16} />
            Raise Advance Request
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-800 p-5 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 text-blue-600 flex items-center justify-center rounded-xl">
            <Banknote size={20} />
          </div>
          <div>
            <p className="text-slate-500 dark:text-slate-400 text-xs font-medium uppercase">Active Balance</p>
            <p className="text-xl font-bold text-slate-900 dark:text-white">₹{totalAdvances.toLocaleString()}</p>
          </div>
        </div>
        <div className="bg-white dark:bg-slate-800 p-5 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 bg-orange-100 dark:bg-orange-900/30 text-orange-600 flex items-center justify-center rounded-xl">
            <History size={20} />
          </div>
          <div>
            <p className="text-slate-500 dark:text-slate-400 text-xs font-medium uppercase">Monthly Deduction</p>
            <p className="text-xl font-bold text-slate-900 dark:text-white">₹{expectedMonthly.toLocaleString()}</p>
          </div>
        </div>
        <div className="bg-white dark:bg-slate-800 p-5 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 bg-green-100 dark:bg-green-900/30 text-green-600 flex items-center justify-center rounded-xl">
            <Banknote size={20} />
          </div>
          <div>
            <p className="text-slate-500 dark:text-slate-400 text-xs font-medium uppercase">Recovered</p>
            <p className="text-xl font-bold text-slate-900 dark:text-white">₹{recoveredAmount.toLocaleString()}</p>
          </div>
        </div>
        <div className="bg-white dark:bg-slate-800 p-5 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 bg-amber-100 dark:bg-amber-900/30 text-amber-600 flex items-center justify-center rounded-xl">
            <Hourglass size={20} />
          </div>
          <div>
            <p className="text-slate-500 dark:text-slate-400 text-xs font-medium uppercase">Pending Requests</p>
            <p className="text-xl font-bold text-slate-900 dark:text-white">₹{pendingRequestAmount.toLocaleString()}</p>
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-200 dark:border-slate-700 flex flex-col gap-4 bg-slate-50 dark:bg-slate-800/50">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <h3 className="font-semibold text-slate-800 dark:text-white">All Advances</h3>
            <div className="flex items-center gap-3 w-full sm:w-auto">
              <div className="relative flex-1 sm:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                <input
                  type="text"
                  placeholder="Search reason..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-sm focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 overflow-x-auto">
            {(['All', 'Pending Approval', 'Active', 'Closed', 'Rejected'] as StatusTab[]).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${activeTab === tab
                  ? 'bg-blue-600 border-blue-600 text-white'
                  : 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
                  }`}
              >
                {tab} <span className="opacity-70">({tabCounts[tab]})</span>
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-50 dark:bg-slate-800/80 text-slate-500 dark:text-slate-400 uppercase text-xs">
              <tr>
                <th className="px-6 py-4 font-medium">Date & Reason</th>
                <th className="px-6 py-4 font-medium">Amount Info</th>
                <th className="px-6 py-4 font-medium">Repayment</th>
                <th className="px-6 py-4 font-medium">Source</th>
                <th className="px-6 py-4 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700/50 text-slate-700 dark:text-slate-300">
              {loading ? (
                <tr><td colSpan={5} className="px-6 py-8 text-center text-slate-500">Loading advances...</td></tr>
              ) : visibleAdvances.length === 0 ? (
                <tr><td colSpan={5} className="px-6 py-8 text-center text-slate-500">No advances found</td></tr>
              ) : visibleAdvances.map((adv) => (
                <tr key={adv.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                  <td className="px-6 py-4">
                    <p className="font-medium text-slate-900 dark:text-white">
                      {adv.date ? format(new Date(adv.date), 'MMM dd, yyyy') : 'N/A'}
                    </p>
                    <p className="text-xs text-slate-500">{adv.advance_type || 'Advance'}</p>
                    {adv.reason && <p className="text-xs text-slate-400 mt-1 max-w-[200px] truncate" title={adv.reason}>{adv.reason}</p>}
                  </td>
                  <td className="px-6 py-4">
                    <p className="font-bold text-slate-900 dark:text-white">₹{Number(adv.amount).toLocaleString()}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Bal: <span className="font-medium text-slate-700 dark:text-slate-300">₹{Number(adv.balance).toLocaleString()}</span>
                    </p>
                  </td>
                  <td className="px-6 py-4">
                    <p className="font-medium">{adv.repayment_type}</p>
                    {adv.installment_amount > 0 && (
                      <p className="text-xs text-slate-500">₹{Number(adv.installment_amount).toLocaleString()}/mo</p>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200">
                      User Request
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border
                      ${adv.status === 'Active' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                        adv.status === 'Closed' ? 'bg-green-50 text-green-700 border-green-200' :
                        adv.status === 'Rejected' ? 'bg-red-50 text-red-700 border-red-200' :
                        'bg-amber-50 text-amber-700 border-amber-200'}`}
                    >
                      {adv.status}
                    </span>
                    {adv.status === 'Rejected' && adv.rejection_reason && (
                      <p className="text-xs text-red-500 mt-1 max-w-[150px] truncate" title={adv.rejection_reason}>
                        {adv.rejection_reason}
                      </p>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showRequestModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xl w-full max-w-lg border border-slate-200 dark:border-slate-800">
            <div className="flex justify-between items-center p-6 border-b border-slate-200 dark:border-slate-800">
              <div>
                <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Raise Advance Request</h2>
                <p className="text-sm text-slate-500 mt-1">Submit a request to HR/Admin for approval</p>
              </div>
              <button onClick={() => setShowRequestModal(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleRequestSubmit} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Advance Type *</label>
                  <select
                    value={requestForm.advance_type}
                    onChange={e => setRequestForm({ ...requestForm, advance_type: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 focus:ring-2 focus:ring-blue-500"
                    required
                  >
                    {ADVANCE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Date Needed *</label>
                  <input
                    type="date"
                    value={requestForm.date}
                    onChange={e => setRequestForm({ ...requestForm, date: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 focus:ring-2 focus:ring-blue-500"
                    required
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Amount Requested (₹) *</label>
                <input
                  type="number"
                  value={requestForm.amount}
                  onChange={e => setRequestForm({ ...requestForm, amount: e.target.value })}
                  placeholder="e.g. 5000"
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 focus:ring-2 focus:ring-blue-500"
                  required min="1"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Pref. Repayment *</label>
                  <select
                    value={requestForm.repayment_type}
                    onChange={e => setRequestForm({ ...requestForm, repayment_type: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="Monthly">Monthly Installments</option>
                    <option value="One-time">One-time Recovery</option>
                  </select>
                </div>
                {requestForm.repayment_type === 'Monthly' && (
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">No. of Installments *</label>
                    <input
                      type="number"
                      value={requestForm.no_of_installments}
                      onChange={e => setRequestForm({ ...requestForm, no_of_installments: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 focus:ring-2 focus:ring-blue-500"
                      required min="1" max="24"
                    />
                  </div>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Reason / Purpose *</label>
                <textarea
                  value={requestForm.reason}
                  onChange={e => setRequestForm({ ...requestForm, reason: e.target.value })}
                  placeholder="Briefly explain why you need this advance"
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 focus:ring-2 focus:ring-blue-500"
                  rows={2} required
                />
              </div>
              <div className="pt-4 flex justify-end gap-3 border-t border-slate-200 dark:border-slate-700 mt-6">
                <button
                  type="button"
                  onClick={() => setShowRequestModal(false)}
                  className="px-4 py-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={requestSubmitting}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
                >
                  {requestSubmitting ? 'Submitting...' : 'Submit Request'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
