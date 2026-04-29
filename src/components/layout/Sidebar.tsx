import {
  LayoutDashboard, Users, Calculator, FileText, BarChart3,
  Settings, Mail, ClipboardList, ChevronRight, Briefcase, Clock3,
  CalendarDays, Banknote
} from 'lucide-react';
import { Page } from '../../types';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

interface NavItem {
  id: Page;
  label: string;
  icon: React.ReactNode;
  badge?: number;
}

const navItems: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={18} /> },
  { id: 'daily-analysis', label: 'Daily Analysis', icon: <BarChart3 size={18} /> },
  { id: 'employees', label: 'Employees', icon: <Users size={18} /> },
  { id: 'attendance', label: 'Attendance', icon: <Clock3 size={18} /> },
  { id: 'payroll', label: 'Payroll', icon: <Calculator size={18} /> },
  { id: 'advance-management', label: 'Advance Mgmt', icon: <Banknote size={18} /> },
  { id: 'payslips', label: 'Payslips', icon: <FileText size={18} /> },
  { id: 'email-logs', label: 'Email Logs', icon: <Mail size={18} /> },
  { id: 'audit-logs', label: 'Audit Logs', icon: <ClipboardList size={18} /> },
  { id: 'settings', label: 'Settings', icon: <Settings size={18} /> },
];

interface SidebarProps {
  currentPage: Page;
  isOpen: boolean;
  onClose: () => void;
}

export function Sidebar({ isOpen, onClose }: SidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();

  const handleNavigate = (page: Page) => {
    navigate(`/${page}`);
    onClose();
  };

  const isActive = (page: Page) => {
    if (page === 'dashboard' && location.pathname === '/') return true;
    return location.pathname === `/${page}`;
  };

  const userEmail = user?.email || 'admin@company.com';
  const userName = user?.user_metadata?.full_name || (user?.email ? user.email.split('@')[0] : 'Admin User');
  const userInitial = userName.charAt(0).toUpperCase();

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-20 lg:hidden"
          onClick={onClose}
        />
      )}
      <aside
        className={`fixed top-0 left-0 h-full w-64 bg-slate-900 dark:bg-slate-950 text-white z-30 flex flex-col transition-transform duration-300 ease-in-out
          ${isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}
      >
        <div className="flex items-center gap-3 px-6 py-5 border-b border-slate-700/50">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center flex-shrink-0">
            <Briefcase size={16} className="text-white" />
          </div>
          <div>
            <h1 className="font-bold text-white text-sm leading-tight">PayrollPro</h1>
            <p className="text-slate-400 text-xs">Enterprise Edition</p>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 overflow-y-auto">
          <p className="text-slate-500 text-xs font-semibold uppercase tracking-wider px-3 mb-2">Main Menu</p>
          {navItems.slice(0, 7).map(item => (
            <NavButton
              key={item.id}
              item={item}
              isActive={isActive(item.id)}
              onClick={() => handleNavigate(item.id)}
            />
          ))}

          <p className="text-slate-500 text-xs font-semibold uppercase tracking-wider px-3 mt-5 mb-2">System</p>
          {navItems.slice(7).map(item => (
            <NavButton
              key={item.id}
              item={item}
              isActive={isActive(item.id)}
              onClick={() => handleNavigate(item.id)}
            />
          ))}
        </nav>

        <div className="px-4 py-4 border-t border-slate-700/50">
          <div className="flex items-center gap-3 px-2 py-2 rounded-lg bg-slate-800/50">
            <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-xs font-bold uppercase">{userInitial}</div>
            <div className="flex-1 min-w-0">
              <p className="text-white text-xs font-medium truncate capitalize">{userName}</p>
              <p className="text-slate-400 text-[10px] truncate">{userEmail}</p>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}

function NavButton({ item, isActive, onClick }: { item: NavItem; isActive: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 group mb-0.5
        ${isActive
          ? 'bg-blue-600 text-white shadow-sm'
          : 'text-slate-400 hover:text-white hover:bg-slate-800'
        }`}
    >
      <span className={`flex-shrink-0 ${isActive ? 'text-white' : 'text-slate-400 group-hover:text-white'}`}>
        {item.icon}
      </span>
      <span className="flex-1 text-left">{item.label}</span>
      {isActive && <ChevronRight size={14} className="text-blue-300" />}
      {item.badge !== undefined && (
        <span className="bg-blue-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
          {item.badge}
        </span>
      )}
    </button>
  );
}
