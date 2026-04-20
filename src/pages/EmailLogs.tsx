import { useState, useEffect } from 'react';
import { Mail, CheckCircle, XCircle, RefreshCw, Plus, Users, Send, Trash2, Search } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useToast } from '../context/ToastContext';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { Input } from '../components/ui/Input';
import { TableSkeleton } from '../components/ui/Skeleton';

interface EmailLog {
  id: string;
  employee_id: string | null;
  payroll_id: string | null;
  email: string;
  subject: string;
  status: string;
  error_message: string | null;
  sent_at: string | null;
  created_at: string;
}

interface EmailGroup {
  id: string;
  name: string;
  description: string;
  member_count?: number;
}

interface Employee {
  id: string;
  name: string;
  email: string;
  department: string;
}

export function EmailLogs() {
  const { showToast } = useToast();
  const [logs, setLogs] = useState<EmailLog[]>([]);
  const [groups, setGroups] = useState<EmailGroup[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Modal states
  const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);
  const [isManageMembersModalOpen, setIsManageMembersModalOpen] = useState(false);
  
  // Form states
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupDesc, setNewGroupDesc] = useState('');
  const [selectedGroup, setSelectedGroup] = useState<EmailGroup | null>(null);
  const [groupMembers, setGroupMembers] = useState<string[]>([]);
  
  const [manualRecipient, setManualRecipient] = useState<Employee | null>(null);
  const [manualEmail, setManualEmail] = useState('');
  const [manualSubject, setManualSubject] = useState('');
  const [manualBody, setManualBody] = useState('');
  const [isSendingManual, setIsSendingManual] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => { 
    loadLogs(); 
    loadGroups();
    loadEmployees();
  }, []);

  async function loadLogs() {
    setLoading(true);
    const { data, error } = await supabase.from('email_logs').select('*').order('created_at', { ascending: false });
    if (error) {
      console.error('Load email logs error:', error);
      showToast('error', 'Failed to load email logs');
    } else {
      setLogs(data || []);
    }
    setLoading(false);
  }

  async function loadGroups() {
    const { data, error } = await supabase.from('email_groups').select('*');
    if (!error) {
      // Fetch member counts for each group
      const groupsWithCounts = await Promise.all((data || []).map(async (g) => {
        const { count } = await supabase
          .from('email_group_members')
          .select('*', { count: 'exact', head: true })
          .eq('group_id', g.id);
        return { ...g, member_count: count || 0 };
      }));
      setGroups(groupsWithCounts);
    }
  }

  async function loadEmployees() {
    const { data } = await supabase.from('employees').select('id, name, email, department').eq('status', 'active');
    setEmployees(data || []);
  }

  async function createGroup() {
    if (!newGroupName.trim()) return;
    const { error } = await supabase.from('email_groups').insert([{ name: newGroupName, description: newGroupDesc }]);
    if (error) {
      showToast('error', 'Failed to create group');
    } else {
      showToast('success', 'Group created');
      setNewGroupName('');
      setNewGroupDesc('');
      setIsGroupModalOpen(false);
      loadGroups();
    }
  }

  async function deleteGroup(id: string) {
    if (!window.confirm('Delete this group?')) return;
    const { error } = await supabase.from('email_groups').delete().eq('id', id);
    if (!error) {
      showToast('success', 'Group deleted');
      loadGroups();
    }
  }

  async function openManageMembers(group: EmailGroup) {
    setSelectedGroup(group);
    const { data } = await supabase.from('email_group_members').select('employee_id').eq('group_id', group.id);
    setGroupMembers((data || []).map(m => m.employee_id));
    setIsManageMembersModalOpen(true);
  }

  async function toggleMember(employeeId: string) {
    if (!selectedGroup) return;
    
    const isMember = groupMembers.includes(employeeId);
    if (isMember) {
      const { error } = await supabase.from('email_group_members').delete().eq('group_id', selectedGroup.id).eq('employee_id', employeeId);
      if (!error) setGroupMembers(prev => prev.filter(id => id !== employeeId));
    } else {
      const { error } = await supabase.from('email_group_members').insert([{ group_id: selectedGroup.id, employee_id: employeeId }]);
      if (!error) setGroupMembers(prev => [...prev, employeeId]);
    }
    loadGroups();
  }

  async function sendManualEmail() {
    if (!manualEmail || !manualSubject) {
      showToast('error', 'Recipient and subject are required');
      return;
    }
    setIsSendingManual(true);
    try {
      const response = await fetch('/api/email/send-manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeId: manualRecipient?.id,
          email: manualEmail,
          subject: manualSubject,
          body: manualBody
        })
      });
      const data = await response.json();
      if (response.ok) {
        showToast('success', 'Email sent successfully');
        setIsManualModalOpen(false);
        setManualRecipient(null);
        setManualEmail('');
        setManualSubject('');
        setManualBody('');
        loadLogs();
      } else {
        throw new Error(data.error || 'Failed to send');
      }
    } catch (err) {
      showToast('error', String(err));
    } finally {
      setIsSendingManual(false);
    }
  }

  async function retryEmail(log: EmailLog) {
    try {
      const response = await fetch(`/api/email/resend/${log.id}`, { method: 'POST' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Failed to resend email');
      showToast('success', `Email to ${log.email} resent successfully`);
    } catch (error) {
      showToast('error', String((error as Error).message || 'Failed to resend email'));
    }
    await loadLogs();
  }

  const sentCount = logs.filter(l => l.status === 'sent').length;
  const failedCount = logs.filter(l => l.status === 'failed').length;

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-white">Email Communications</h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm">Track deliveries and manage communication groups</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" icon={<Users size={16} />} onClick={() => setIsGroupModalOpen(true)}>Manage Groups</Button>
          <Button icon={<Send size={16} />} onClick={() => setIsManualModalOpen(true)}>Send Manual Email</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: 'Total Sent', value: sentCount, icon: <CheckCircle size={18} className="text-emerald-600" />, bg: 'bg-emerald-100 dark:bg-emerald-900/30' },
          { label: 'Failed', value: failedCount, icon: <XCircle size={18} className="text-red-600" />, bg: 'bg-red-100 dark:bg-red-900/30' },
          { label: 'Total Logs', value: logs.length, icon: <Mail size={18} className="text-blue-600" />, bg: 'bg-blue-100 dark:bg-blue-900/30' },
        ].map(item => (
          <Card key={item.label}>
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${item.bg}`}>
                {item.icon}
              </div>
              <div>
                <p className="text-xs text-slate-500 dark:text-slate-400">{item.label}</p>
                <p className="font-bold text-slate-800 dark:text-white">{item.value}</p>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Logs Table */}
        <div className="lg:col-span-2">
          <Card padding={false}>
            <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
              <p className="font-semibold text-slate-800 dark:text-white text-sm">Email Delivery Log</p>
              <Button variant="ghost" size="sm" icon={<RefreshCw size={13} />} onClick={loadLogs}>Refresh</Button>
            </div>
            <div className="overflow-x-auto">
              {loading ? (
                <div className="p-5"><TableSkeleton rows={4} cols={5} /></div>
              ) : logs.length === 0 ? (
                <div className="py-16 text-center">
                  <Mail size={36} className="mx-auto text-slate-300 dark:text-slate-600 mb-3" />
                  <p className="text-slate-500 dark:text-slate-400 text-sm">No email logs yet</p>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 dark:border-slate-700">
                      {['Recipient', 'Subject', 'Status', 'Sent At', 'Actions'].map(h => (
                        <th key={h} className={`py-3 px-4 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider text-left ${h === 'Actions' ? 'text-right' : ''}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map(log => (
                      <tr key={log.id} className="border-b border-slate-50 dark:border-slate-700/30 hover:bg-slate-50/50 dark:hover:bg-slate-700/20">
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <Mail size={14} className="text-slate-400 flex-shrink-0" />
                            <span className="text-xs text-slate-700 dark:text-slate-200">{log.email}</span>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-xs text-slate-500 dark:text-slate-400 max-w-[150px] truncate">{log.subject || '—'}</td>
                        <td className="py-3 px-4">
                          <Badge variant={log.status === 'sent' ? 'success' : log.status === 'failed' ? 'error' : 'warning'} dot>
                            {log.status}
                          </Badge>
                        </td>
                        <td className="py-3 px-4 text-xs text-slate-400">
                          {log.sent_at ? new Date(log.sent_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}
                        </td>
                        <td className="py-3 px-4 text-right">
                          {log.status === 'failed' && (
                            <Button size="sm" variant="secondary" icon={<RefreshCw size={12} />} onClick={() => retryEmail(log)}>Retry</Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </Card>
        </div>

        {/* Groups Sidebar */}
        <div className="space-y-4">
          <Card padding={false}>
            <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
              <p className="font-semibold text-slate-800 dark:text-white text-sm">Email Groups</p>
              <button onClick={() => setIsGroupModalOpen(true)} className="p-1 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-blue-600">
                <Plus size={16} />
              </button>
            </div>
            <div className="p-2 space-y-1">
              {groups.length === 0 ? (
                <p className="text-xs text-slate-400 p-4 text-center">No groups created</p>
              ) : (
                groups.map(group => (
                  <div key={group.id} className="p-3 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/50 group transition-colors">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{group.name}</p>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => openManageMembers(group)} className="p-1 text-slate-400 hover:text-blue-600" title="Manage Members">
                          <Users size={14} />
                        </button>
                        <button onClick={() => deleteGroup(group.id)} className="p-1 text-slate-400 hover:text-red-600" title="Delete Group">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] text-slate-400 truncate max-w-[120px]">{group.description || 'No description'}</p>
                      <Badge variant="neutral">{group.member_count} members</Badge>
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>
      </div>

      {/* Group Create Modal */}
      <Modal
        isOpen={isGroupModalOpen}
        onClose={() => setIsGroupModalOpen(false)}
        title="Create Email Group"
        footer={<Button onClick={createGroup}>Create Group</Button>}
      >
        <div className="space-y-4">
          <Input label="Group Name" value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} placeholder="e.g., Engineering Team" />
          <Input label="Description" value={newGroupDesc} onChange={(e) => setNewGroupDesc(e.target.value)} placeholder="Optional description" />
        </div>
      </Modal>

      {/* Manage Members Modal */}
      <Modal
        isOpen={isManageMembersModalOpen}
        onClose={() => setIsManageMembersModalOpen(false)}
        title={`Manage Group: ${selectedGroup?.name}`}
        size="lg"
      >
        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input 
              type="text" 
              placeholder="Search employees..." 
              className="w-full pl-10 pr-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="max-h-96 overflow-y-auto space-y-2">
            {employees.filter(e => e.name.toLowerCase().includes(searchTerm.toLowerCase())).map(emp => (
              <div key={emp.id} className="flex items-center justify-between p-3 rounded-lg border border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                <div>
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{emp.name}</p>
                  <p className="text-[10px] text-slate-400">{emp.department} • {emp.email}</p>
                </div>
                <button 
                  onClick={() => toggleMember(emp.id)}
                  className={`p-1.5 rounded-lg transition-colors ${groupMembers.includes(emp.id) ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/30' : 'bg-slate-100 text-slate-400 dark:bg-slate-800'}`}
                >
                  <CheckCircle size={16} className={groupMembers.includes(emp.id) ? 'opacity-100' : 'opacity-20'} />
                </button>
              </div>
            ))}
          </div>
        </div>
      </Modal>

      {/* Manual Send Modal */}
      <Modal
        isOpen={isManualModalOpen}
        onClose={() => setIsManualModalOpen(false)}
        title="Send Manual Email"
        size="lg"
        footer={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setIsManualModalOpen(false)}>Cancel</Button>
            <Button icon={<Send size={14} />} onClick={sendManualEmail} loading={isSendingManual}>Send Email</Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Select Employee (Optional)</label>
              <select 
                className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm"
                onChange={(e) => {
                  const emp = employees.find(x => x.id === e.target.value);
                  if (emp) {
                    setManualRecipient(emp);
                    setManualEmail(emp.email);
                  }
                }}
              >
                <option value="">Choose employee...</option>
                {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </div>
            <Input 
              label="Recipient Email" 
              value={manualEmail} 
              onChange={(e) => setManualEmail(e.target.value)} 
              placeholder="email@example.com" 
            />
          </div>
          <Input 
            label="Subject" 
            value={manualSubject} 
            onChange={(e) => setManualSubject(e.target.value)} 
            placeholder="Enter email subject" 
          />
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Message Body</label>
            <textarea 
              className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm min-h-[150px] focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={manualBody}
              onChange={(e) => setManualBody(e.target.value)}
              placeholder="Type your message here..."
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
