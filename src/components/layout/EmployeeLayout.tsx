import { useState, ReactNode } from 'react';
import { EmployeeSidebar } from './EmployeeSidebar';
import { Menu, Sun, Moon, Bell, LogOut } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';

interface EmployeeNavbarProps {
  pageTitle: string;
  onMenuToggle: () => void;
}

function EmployeeNavbar({ pageTitle, onMenuToggle }: EmployeeNavbarProps) {
  const { theme, toggleTheme } = useTheme();
  const { logout, user, employeeRecord } = useAuth();
  
  const userEmail = employeeRecord?.email || user?.email || 'User';
  const userName = employeeRecord?.name || user?.user_metadata?.full_name || (user?.email ? user.email.split('@')[0] : 'User');
  const userInitial = userName.charAt(0).toUpperCase();

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
            {pageTitle}
          </h2>
          <p className="text-slate-400 text-xs hidden sm:block">
            {new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={toggleTheme}
          className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          title="Toggle theme"
        >
          {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
        </button>

        <button className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors relative">
          <Bell size={18} />
        </button>

        <div className="flex items-center gap-2 pl-2 border-l border-slate-200 dark:border-slate-700 ml-1">
          <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center text-xs font-bold text-white uppercase">
            {userInitial}
          </div>
          <button
            onClick={() => logout()}
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

interface EmployeeLayoutProps {
  children: ReactNode;
  currentPage: string;
  pageTitle: string;
}

export function EmployeeLayout({ children, currentPage, pageTitle }: EmployeeLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex">
      <EmployeeSidebar
        currentPage={currentPage}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="flex-1 lg:ml-64 flex flex-col min-h-screen">
        <EmployeeNavbar
          pageTitle={pageTitle}
          onMenuToggle={() => setSidebarOpen(s => !s)}
        />
        <main className="flex-1 p-4 lg:p-6 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
