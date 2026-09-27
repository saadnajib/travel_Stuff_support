import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { getSessions, revokeSession, updateMe } from '../api/endpoints';
import type { Session } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Field } from '../components/Field';
import { KycBadge } from '../components/KycBadge';
import { EmptyState, ErrorState, Loading } from '../components/Loading';
import { useToast } from '../components/Toast';
import { formatDate, formatDateTime } from '../lib/format';
import { useAsync } from '../lib/useAsync';

const PHONE_RE = /^\+?[0-9 ()-]{7,20}$/;

function describeAgent(ua: string | null): string {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}

export function AccountPage() {
  const { user, refreshUser, logout } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const sessions = useAsync(getSessions, []);
  const [name, setName] = useState(user?.name ?? '');
  const [phone, setPhone] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);

  useEffect(() => {
    if (user) setName(user.name);
  }, [user]);

  if (!user) return null;

  const onSave = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (name.trim().length < 2) errs.name = 'Name must be at least 2 characters.';
    if (phone && !PHONE_RE.test(phone.trim())) errs.phone = 'Enter a valid phone number, e.g. +44 7700 900123.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const patch: { name?: string; phone?: string } = {};
    if (name.trim() !== user.name) patch.name = name.trim();
    if (phone.trim()) patch.phone = phone.trim();
    if (!patch.name && !patch.phone) {
      toast.info('Nothing to update.');
      return;
    }
    setPending(true);
    try {
      await updateMe(patch);
      await refreshUser();
      setPhone('');
      toast.success('Profile updated.');
    } catch (err) {
      toast.error(err);
    } finally {
      setPending(false);
    }
  };

  const onRevoke = async (s: Session) => {
    if (s.current && !window.confirm('This is your current session. Revoking it will sign you out. Continue?')) return;
    setRevoking(s.id);
    try {
      await revokeSession(s.id);
      if (s.current) {
        await logout();
        navigate('/login');
        return;
      }
      sessions.setData((prev) => (prev ?? []).filter((x) => x.id !== s.id));
      toast.success('Session revoked.');
    } catch (err) {
      toast.error(err);
    } finally {
      setRevoking(null);
    }
  };

  return (
    <div className="page narrow">
      <h1>Account</h1>
      <section className="card">
        <h2>Profile</h2>
        <dl className="facts">
          <div>
            <dt>Email</dt>
            <dd>
              {user.email} {user.emailVerified ? '' : <span className="small text-danger">(unverified)</span>}
            </dd>
          </div>
          <div>
            <dt>Identity</dt>
            <dd>
              <KycBadge status={user.kycStatus} />
            </dd>
          </div>
          <div>
            <dt>Member since</dt>
            <dd>{formatDate(user.createdAt)}</dd>
          </div>
          <div>
            <dt>Phone</dt>
            <dd>{user.phoneMasked ?? 'Not set'}</dd>
          </div>
        </dl>
        <form onSubmit={onSave} noValidate>
          <fieldset disabled={pending}>
            <div className="form-grid">
              <Field label="Name" htmlFor="acc-name" error={errors.name}>
                <input id="acc-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={80} />
              </Field>
              <Field
                label={user.phoneMasked ? 'Replace phone number' : 'Phone number'}
                htmlFor="acc-phone"
                error={errors.phone}
                hint="Stored encrypted. Only a masked version is ever shown."
              >
                <input id="acc-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" />
              </Field>
            </div>
            <button type="submit" className="btn" disabled={pending}>
              {pending ? 'Saving…' : 'Save changes'}
            </button>
          </fieldset>
        </form>
      </section>

      <section className="card">
        <h2>Active sessions</h2>
        <p className="muted small">Devices currently signed in to your account. Revoke any you don't recognise.</p>
        {sessions.loading && <Loading />}
        {!!sessions.error && <ErrorState error={sessions.error} onRetry={sessions.reload} />}
        {sessions.data && sessions.data.length === 0 && <EmptyState title="No active sessions" />}
        <ul className="session-list">
          {sessions.data?.map((s) => (
            <li key={s.id} className="session">
              <div>
                <strong>{describeAgent(s.userAgent)}</strong>
                {s.current && <span className="pill pill-success">This device</span>}
                <div className="small muted">
                  {s.ip ?? 'Unknown IP'} · signed in {formatDateTime(s.createdAt)} · last used {formatDateTime(s.lastUsedAt)}
                </div>
              </div>
              <button type="button" className="btn btn-sm btn-secondary" disabled={revoking === s.id} onClick={() => void onRevoke(s)}>
                {revoking === s.id ? 'Revoking…' : 'Revoke'}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
