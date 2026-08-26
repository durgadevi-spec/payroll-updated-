import { ThemeProvider } from './context/ThemeContext';
import { ToastProvider } from './context/ToastContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Layout } from './components/layout/Layout';
import { EmployeeLayout } from './components/layout/EmployeeLayout';
import { Login } from './pages/Login';
import { Signup } from './pages/Signup';
import { ForgotPassword } from './pages/ForgotPassword';
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
import { MyAdvances } from './pages/employee/MyAdvances';
import { MyPayslips } from './pages/employee/MyPayslips';
import { MyAttendance } from './pages/employee/MyAttendance';
import { Page } from './types';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';

function AdminProtectedRoute({ children, pageId }: { children: React.ReactNode, pageId: Page }) {
  const { isAuthenticated, role, loading } = useAuth();
  const location = useLocation();

  if (loading) return null;

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  
  if (role !== 'admin') {
    return <Navigate to="/my/advances" replace />;
  }

  return (
    <Layout currentPage={pageId}>
      {children}
    </Layout>
  );
}

function EmployeeProtectedRoute({ children, pageId, pageTitle }: { children: React.ReactNode, pageId: string, pageTitle: string }) {
  const { isAuthenticated, role, loading } = useAuth();
  const location = useLocation();

  if (loading) return null;

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Allow admins to also view employee routes if they want, but default to blocking.
  // Actually, per requirements, admin layout is different. Let's just strictly enforce employee role for employee pages for now.
  if (role !== 'employee') {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <EmployeeLayout currentPage={pageId} pageTitle={pageTitle}>
      {children}
    </EmployeeLayout>
  );
}

function AppContent() {
  const { isAuthenticated, role, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!loading && isAuthenticated && (location.pathname === '/login' || location.pathname === '/signup' || location.pathname === '/')) {
      if (role === 'employee') {
        navigate('/my/advances');
      } else {
        navigate('/dashboard');
      }
    }
  }, [isAuthenticated, role, loading, location.pathname, navigate]);

  if (loading) return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center">
      <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
    </div>
  );

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      
      <Route path="/" element={<Navigate to={role === 'employee' ? "/my/advances" : "/dashboard"} replace />} />
      
      {/* Admin Routes */}
      <Route path="/dashboard" element={<AdminProtectedRoute pageId="dashboard"><Dashboard /></AdminProtectedRoute>} />
      <Route path="/daily-analysis" element={<AdminProtectedRoute pageId="daily-analysis"><DailyAnalysis /></AdminProtectedRoute>} />
      <Route path="/employees" element={<AdminProtectedRoute pageId="employees"><Employees /></AdminProtectedRoute>} />
      <Route path="/attendance" element={<AdminProtectedRoute pageId="attendance"><Attendance /></AdminProtectedRoute>} />
      <Route path="/payroll" element={<AdminProtectedRoute pageId="payroll"><Payroll /></AdminProtectedRoute>} />
      <Route path="/advance-management" element={<AdminProtectedRoute pageId="advance-management"><AdvanceManagement /></AdminProtectedRoute>} />
      <Route path="/payslips" element={<AdminProtectedRoute pageId="payslips"><Payslips /></AdminProtectedRoute>} />
      <Route path="/reports" element={<AdminProtectedRoute pageId="reports"><Reports /></AdminProtectedRoute>} />
      <Route path="/settings" element={<AdminProtectedRoute pageId="settings"><Settings /></AdminProtectedRoute>} />
      <Route path="/email-logs" element={<AdminProtectedRoute pageId="email-logs"><EmailLogs /></AdminProtectedRoute>} />
      <Route path="/audit-logs" element={<AdminProtectedRoute pageId="audit-logs"><AuditLogs /></AdminProtectedRoute>} />
      
      {/* Employee Routes */}
      <Route path="/my/advances" element={<EmployeeProtectedRoute pageId="advances" pageTitle="My Advances"><MyAdvances /></EmployeeProtectedRoute>} />
      <Route path="/my/payslips" element={<EmployeeProtectedRoute pageId="payslips" pageTitle="My Payslips"><MyPayslips /></EmployeeProtectedRoute>} />
      <Route path="/my/attendance" element={<EmployeeProtectedRoute pageId="attendance" pageTitle="My Attendance"><MyAttendance /></EmployeeProtectedRoute>} />
      
      <Route path="*" element={<Navigate to={role === 'employee' ? "/my/advances" : "/dashboard"} replace />} />
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