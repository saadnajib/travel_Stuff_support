import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { KycBadge } from './KycBadge';
import { useToast } from './Toast';

export function Header() {
  const { user, loading, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();

  useEffect(() => setOpen(false), [location.pathname]);

  const onLogout = async () => {
    await logout();
    navigate('/', { replace: true });
    toast.info('You have been signed out.');
  };

  const navCls = ({ isActive }: { isActive: boolean }) => (isActive ? 'nav-link active' : 'nav-link');

  return (
    <header className="site-header">
      <div className="header-inner">
        <Link to="/" className="brand" aria-label="CarryLink home">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" width="28" height="28">
              <rect width="32" height="32" rx="8" fill="currentColor" />
              <path d="M9 17l5 5 9-11" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          CarryLink
        </Link>
        <button
          type="button"
          className="menu-toggle"
          aria-expanded={open}
          aria-controls="main-nav"
          onClick={() => setOpen((o) => !o)}
        >
          <span className="sr-only">Menu</span>
          <span aria-hidden="true">{open ? '×' : '☰'}</span>
        </button>
        <nav id="main-nav" className={open ? 'nav open' : 'nav'} aria-label="Main">
          <NavLink to="/trips" className={navCls} end>
            Find travellers
          </NavLink>
          <NavLink to="/requests" className={navCls} end>
            Find requests
          </NavLink>
          {user && (
            <>
              <NavLink to="/dashboard" className={navCls}>
                Dashboard
              </NavLink>
              <NavLink to="/matches" className={navCls}>
                Matches
              </NavLink>
              {user.role === 'admin' && (
                <NavLink to="/admin" className={navCls}>
                  Admin
                </NavLink>
              )}
            </>
          )}
          <div className="nav-auth">
            {loading ? null : user ? (
              <>
                <NavLink to="/account" className={navCls} title="Account">
                  {user.name.split(' ')[0]}
                </NavLink>
                <KycBadge status={user.kycStatus} compact />
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => void onLogout()}>
                  Sign out
                </button>
              </>
            ) : (
              <>
                <NavLink to="/login" className={navCls}>
                  Sign in
                </NavLink>
                <Link to="/register" className="btn btn-sm">
                  Get started
                </Link>
              </>
            )}
          </div>
        </nav>
      </div>
    </header>
  );
}
