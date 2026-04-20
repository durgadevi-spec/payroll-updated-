import { Menu, Sun, Moon, Bell, LogOut, Search } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { Page } from '../../types';

const pageTitles: Record<Page, string> = {
  dashboard: 'Dashboard',
  employees: 'Employee Management',
  payroll: 'Payroll',
  payslips: 'Payslips',
  reports: 'Reports',
  settings: 'Settings',
  'email-logs': 'Email Logs',
  'audit-logs': 'Audit Logs',
};

interface NavbarProps {
  currentPage: Page;
  onMenuToggle: () => void;
}

export function Navbar({ currentPage, onMenuToggle }: NavbarProps) {
  const { theme, toggleTheme } = useTheme();
  const { logout, userEmail } = useAuth();

  return (
    <header className="h-16 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700/50 flex items-center justify-between px-4 lg:px-6 sticky top-0 z-10">
      <div className="flex items-center gap-3">
        <button
          onClick={onMenuToggle}
          className="lg:hidden p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          <Menu size={20} />
        </button>
        <div>
          <h2 className="font-semibold text-slate-800 dark:text-white text-sm lg:text-base">
            {pageTitles[currentPage]}
          </h2>
          <p className="text-slate-400 text-xs hidden sm:block">
            {new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="hidden md:flex items-center gap-2 bg-slate-100 dark:bg-slate-800 rounded-lg px-3 py-2 w-48 lg:w-64">
          <Search size={15} className="text-slate-400" />
          <span className="text-slate-400 text-sm">Quick search...</span>
        </div>

        <button
          onClick={toggleTheme}
          className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          title="Toggle theme"
        >
          {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
        </button>

        <button className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors relative">
          <Bell size={18} />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-blue-500 rounded-full" />
        </button>

        <div className="flex items-center gap-2 pl-2 border-l border-slate-200 dark:border-slate-700 ml-1">
          <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center text-xs font-bold text-white">
            {userEmail.charAt(0).toUpperCase()}
          </div>
          <button
            onClick={logout}
            className="p-1.5 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            title="Logout"
          >
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </header>
  );
}
