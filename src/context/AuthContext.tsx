import { createContext, useContext, useState, ReactNode, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { User, Session } from '@supabase/supabase-js';

interface AuthContextType {
  isAuthenticated: boolean;
  user: User | null;
  role: 'admin' | 'employee' | null;
  employeeRecord: any | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<{ error: any }>;
  signup: (email: string, password: string) => Promise<{ error: any }>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  isAuthenticated: false,
  user: null,
  role: null,
  employeeRecord: null,
  loading: true,
  login: async () => ({ error: null }),
  signup: async () => ({ error: null }),
  logout: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<'admin' | 'employee' | null>(null);
  const [employeeRecord, setEmployeeRecord] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  async function fetchRole(session: Session | null) {
    if (!session?.user) {
      setRole(null);
      setEmployeeRecord(null);
      return;
    }
    
    try {
      const res = await fetch('/api/me', {
        headers: { 'Authorization': `Bearer ${session.access_token}` }
      });
      if (res.ok) {
        const data = await res.json();
        const normalizedRole = String(data.role || 'employee').trim().toLowerCase();
        setRole(normalizedRole === 'admin' ? 'admin' : 'employee');
        setEmployeeRecord(data.employee);
      } else {
        // No employee record found — user is an admin
        setRole('admin');
      }
    } catch (e) {
      console.error('Failed to fetch role:', e);
      // Network error — assume admin so they can still access the app
      setRole('admin');
    }
  }

  useEffect(() => {
    // Check active sessions and sets the user
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user) {
        setUser(session.user);
        await fetchRole(session);
      } else {
        setUser(null);
        setRole(null);
        setEmployeeRecord(null);
      }
      setLoading(false);
    });

    // Listen for changes on auth state (logged in, signed out, etc.)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) {
        setLoading(true); // block rendering while we resolve the role
        setUser(session.user);
        await fetchRole(session);
        setLoading(false);
      } else {
        // Logout — clear everything immediately, no async work needed
        setUser(null);
        setRole(null);
        setEmployeeRecord(null);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const login = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  };

  const signup = async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({ email, password });
    return { error };
  };

  const logout = async () => {
    try {
      await supabase.auth.signOut({ scope: 'local' });
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      setUser(null);
      setRole(null);
      setEmployeeRecord(null);
      setLoading(false);
      window.location.assign('/login');
    }
  };

  return (
    <AuthContext.Provider value={{ 
      isAuthenticated: !!user, 
      user, 
      role,
      employeeRecord,
      loading,
      login, 
      signup,
      logout 
    }}>
      {!loading && children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
