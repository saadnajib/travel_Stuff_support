import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { onSessionChange, refreshSession, setAccessToken, setUnauthorizedHandler } from '../api/client';
import * as endpoints from '../api/endpoints';
import type { User } from '../api/types';

export interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<User | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// Shared across StrictMode double-mounts so we only restore once per page load.
let restorePromise: Promise<User | null> | null = null;
function restoreOnce(): Promise<User | null> {
  if (!restorePromise) restorePromise = refreshSession().then((r) => r?.user ?? null);
  return restorePromise;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  // Silent session restore from the refresh cookie.
  useEffect(() => {
    let active = true;
    restoreOnce().then((u) => {
      if (!active) return;
      setUser(u);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  // Keep user in sync with refreshes/expiry happening inside the API client.
  useEffect(() => onSessionChange((u) => setUser(u)), []);

  // SPA redirect when a session can no longer be refreshed.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      const { pathname, search } = window.location;
      if (pathname.startsWith('/login')) return;
      navigate(`/login?next=${encodeURIComponent(pathname + search)}`, { replace: true });
    });
  }, [navigate]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await endpoints.login({ email, password });
    setUser(res.user);
    return res.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await endpoints.logout();
    } catch {
      // Even if the server call fails, drop local state.
    } finally {
      setAccessToken(null);
      setUser(null);
    }
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const u = await endpoints.getMe();
      setUser(u);
      return u;
    } catch {
      return null;
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, login, logout, refreshUser }),
    [user, loading, login, logout, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
