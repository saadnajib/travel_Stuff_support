import { useState, type FormEvent } from 'react';
import { adminGetUsers, adminSuspendUser } from '../../api/endpoints';
import type { User } from '../../api/types';
import { KycBadge } from '../../components/KycBadge';
import { EmptyState, ErrorState, Loading } from '../../components/Loading';
import { useToast } from '../../components/Toast';
import { formatDate } from '../../lib/format';
import { useAsync } from '../../lib/useAsync';

export function UsersTab() {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [pendingId, setPendingId] = useState<string | null>(null);
  const list = useAsync(() => adminGetUsers(query || undefined), [query]);

  const onSearch = (e: FormEvent) => {
    e.preventDefault();
    setQuery(q.trim());
  };

  const toggle = async (u: User) => {
    const suspending = !u.suspended;
    const reason = window.prompt(suspending ? `Reason for suspending ${u.name}:` : `Reason for reinstating ${u.name}:`);
    if (reason === null) return;
    if (reason.trim().length < 3) {
      toast.error('Please give a reason (at least 3 characters).');
      return;
    }
    setPendingId(u.id);
    try {
      const updated = await adminSuspendUser(u.id, { suspended: suspending, reason: reason.trim() });
      list.setData((prev) => (prev ?? []).map((x) => (x.id === updated.id ? updated : x)));
      toast.success(suspending ? `${u.name} suspended.` : `${u.name} reinstated.`);
    } catch (e) {
      toast.error(e);
    } finally {
      setPendingId(null);
    }
  };

  return (
    <div>
      <form className="row gap-1 section-tight" onSubmit={onSearch} role="search">
        <label htmlFor="user-q" className="sr-only">
          Search users
        </label>
        <input id="user-q" placeholder="Search by name or email" value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="submit" className="btn btn-sm">
          Search
        </button>
      </form>
      {list.loading && <Loading />}
      {!!list.error && <ErrorState error={list.error} onRetry={list.reload} />}
      {list.data && list.data.length === 0 && <EmptyState title="No users found" />}
      {list.data && list.data.length > 0 && (
        <div className="table-wrap card">
          <table className="table">
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Email</th>
                <th>KYC</th>
                <th className="num">Trust</th>
                <th>Joined</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.data.map((u) => (
                <tr key={u.id}>
                  <td>
                    <strong>{u.name}</strong>
                    <div className="small muted">{u.email}</div>
                  </td>
                  <td>{u.role}</td>
                  <td>{u.emailVerified ? 'Verified' : 'Unverified'}</td>
                  <td>
                    <KycBadge status={u.kycStatus} compact />
                  </td>
                  <td className="num">{Math.round(u.trustScore)}</td>
                  <td>{formatDate(u.createdAt)}</td>
                  <td>{u.suspended ? <span className="pill pill-danger">Suspended</span> : <span className="pill pill-success">Active</span>}</td>
                  <td>
                    {u.role !== 'admin' && (
                      <button
                        type="button"
                        className={u.suspended ? 'btn btn-sm btn-secondary' : 'btn btn-sm btn-danger'}
                        disabled={pendingId === u.id}
                        onClick={() => void toggle(u)}
                      >
                        {u.suspended ? 'Unsuspend' : 'Suspend'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
