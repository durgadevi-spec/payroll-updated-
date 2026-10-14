import { useState, ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { Navbar } from './Navbar';
import { Page } from '../../types';

interface LayoutProps {
  children: ReactNode;
  currentPage: Page;
}

export function Layout({ children, currentPage }: LayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex">
      <Sidebar
        currentPage={currentPage}
        isOpen={sidebarOpen}
        isCollapsed={sidebarCollapsed}
        onClose={() => setSidebarOpen(false)}
      />

      <div className={`flex-1 flex flex-col min-h-screen transition-[margin] duration-300 ${sidebarCollapsed ? 'lg:ml-20' : 'lg:ml-64'}`}>
        <Navbar
          currentPage={currentPage}
          onMenuToggle={() => setSidebarOpen(s => !s)}
          onSidebarCollapse={() => setSidebarCollapsed(s => !s)}
          sidebarCollapsed={sidebarCollapsed}
        />
        <main className="flex-1 p-4 lg:p-6 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
