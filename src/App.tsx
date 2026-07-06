import { ThemeProvider } from './context/ThemeContext';
import { ToastProvider } from './context/ToastContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Layout } from './components/layout/Layout';
import { Login } from './pages/Login';
import { Signup } from './pages/Signup';
import { Dashboard } from './pages/Dashboard';
import { DailyAnalysis } from './pages/DailyAnalysis';
import { Employees } from './pages/Employees';
import { Attendance } from './pages/Attendance';
import { Payroll } from './pages/Payroll';
import { AdvanceManagement } from './pages/AdvanceManagement';
import { Payslips } from './pages/Payslips';
import { Reports } from './pages/Reports';
import { Settings } from './pages/Settings';
import { EmailLogs } from './pages/EmailLogs';
import { AuditLogs } from './pages/AuditLogs';
import { Page } from './types';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';

function ProtectedRoute({ children, pageId }: { children: React.ReactNode, pageId: Page }) {
  const { isAuthenticated, loading } = useAuth();
  const location = useLocation();

  if (loading) return null;

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return (
    <Layout currentPage={pageId}>
      {children}
    </Layout>
  );
}

function AppContent() {
  const { isAuthenticated, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!loading && isAuthenticated && (location.pathname === '/login' || location.pathname === '/signup')) {
      navigate('/dashboard');
    }
  }, [isAuthenticated, loading, location.pathname, navigate]);

  if (loading) return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center">
      <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
    </div>
  );

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      
      <Route path="/dashboard" element={<ProtectedRoute pageId="dashboard"><Dashboard /></ProtectedRoute>} />
      <Route path="/daily-analysis" element={<ProtectedRoute pageId="daily-analysis"><DailyAnalysis /></ProtectedRoute>} />
      <Route path="/employees" element={<ProtectedRoute pageId="employees"><Employees /></ProtectedRoute>} />
      <Route path="/attendance" element={<ProtectedRoute pageId="attendance"><Attendance /></ProtectedRoute>} />
      <Route path="/payroll" element={<ProtectedRoute pageId="payroll"><Payroll /></ProtectedRoute>} />
      <Route path="/advance-management" element={<ProtectedRoute pageId="advance-management"><AdvanceManagement /></ProtectedRoute>} />
      <Route path="/payslips" element={<ProtectedRoute pageId="payslips"><Payslips /></ProtectedRoute>} />
      <Route path="/reports" element={<ProtectedRoute pageId="reports"><Reports /></ProtectedRoute>} />
      <Route path="/settings" element={<ProtectedRoute pageId="settings"><Settings /></ProtectedRoute>} />
      <Route path="/email-logs" element={<ProtectedRoute pageId="email-logs"><EmailLogs /></ProtectedRoute>} />
      <Route path="/audit-logs" element={<ProtectedRoute pageId="audit-logs"><AuditLogs /></ProtectedRoute>} />
      
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <ToastProvider>
          <BrowserRouter>
            <AppContent />
          </BrowserRouter>
        </ToastProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
