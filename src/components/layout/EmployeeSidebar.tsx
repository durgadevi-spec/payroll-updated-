import {
  Banknote, FileText, Clock3, ChevronRight, Briefcase, User
} from 'lucide-react';
import { Page } from '../../types';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

interface NavItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  badge?: number;
}

const navItems: NavItem[] = [
  { id: 'advances', label: 'My Advances', icon: <Banknote size={18} /> },
  { id: 'payslips', label: 'My Payslips', icon: <FileText size={18} /> },
  { id: 'attendance', label: 'My Attendance', icon: <Clock3 size={18} /> },
];

interface EmployeeSidebarProps {
  currentPage: string;
  isOpen: boolean;
  onClose: () => void;
}

export function EmployeeSidebar({ isOpen, onClose }: EmployeeSidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, employeeRecord } = useAuth();

  const handleNavigate = (page: string) => {
    navigate(`/my/${page}`);
    onClose();
  };

  const isActive = (page: string) => {
    return location.pathname === `/my/${page}`;
  };

  const userEmail = employeeRecord?.email || user?.email || '';
  const userName = employeeRecord?.name || user?.user_metadata?.full_name || (user?.email ? user.email.split('@')[0] : 'Employee');
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
            <User size={16} className="text-white" />
          </div>
          <div>
            <h1 className="font-bold text-white text-sm leading-tight">PayrollPro</h1>
            <p className="text-slate-400 text-xs">Self Service</p>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 overflow-y-auto">
          <p className="text-slate-500 text-xs font-semibold uppercase tracking-wider px-3 mb-2">My Portal</p>
          {navItems.map(item => (
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
