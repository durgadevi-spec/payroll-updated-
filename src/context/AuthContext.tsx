import { createContext, useContext, useState, ReactNode, useEffect, useRef } from 'react';
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

  // Mirrors of the latest user/role state, kept in sync via effects below.
  // The onAuthStateChange subscription is set up once (empty dep array) so
  // its callback closure would otherwise only ever see the initial (null)
  // user/role — these refs let it read the current values without having
  // to resubscribe every time state changes.
  const userRef = useRef<User | null>(null);
  const roleRef = useRef<'admin' | 'employee' | null>(null);
  useEffect(() => { userRef.current = user; }, [user]);
  useEffect(() => { roleRef.current = role; }, [role]);

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
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (session?.user) {
        // Supabase fires this listener again with a 'TOKEN_REFRESHED' (or
        // repeat 'SIGNED_IN') event whenever the browser tab regains focus/
        // visibility, even though the signed-in user hasn't actually changed.
        // Previously we unconditionally did setLoading(true) here, and every
        // protected route in App.tsx does `if (loading) return null`, so a
        // simple tab-away-and-back would unmount and remount the entire
        // current page (losing scroll position, open modals, in-progress
        // payroll review, etc.) — it looked like the page was reloading.
        // Only re-fetch the role and show the loading screen for an actual
        // sign-in of a different (or previously unknown) user; for a token
        // refresh of the same already-resolved user, just update the user
        // object silently and leave the rest of the app untouched.
        const isSameUserAlreadyResolved = (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') && userRef.current?.id === session.user.id && roleRef.current !== null;
        if (isSameUserAlreadyResolved) {
          setUser(session.user);
        } else {
          setLoading(true); // block rendering while we resolve the role
          setUser(session.user);
          await fetchRole(session);
          setLoading(false);
        }
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