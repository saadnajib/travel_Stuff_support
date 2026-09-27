import type { ReactNode } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { Loading } from '../components/Loading';
import { useAuth } from './AuthContext';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Loading label="Restoring your session…" />;
  if (!user) {
    const next = location.pathname + location.search;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }
  return <>{children}</>;
}

export function RequireAdmin({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Loading label="Restoring your session…" />;
  if (!user) {
    const next = location.pathname + location.search;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }
  if (user.role !== 'admin') {
    return (
      <div className="page narrow">
        <div className="card">
          <h1>Admins only</h1>
          <p className="muted">You don't have permission to view this page.</p>
          <Link className="btn" to="/dashboard">
            Back to dashboard
          </Link>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

/** Only allow same-app relative redirects (guards against open redirects via ?next=). */
export function safeNext(next: string | null, fallback = '/dashboard'): string {
  if (!next) return fallback;
  if (!next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return fallback;
  return next;
}
