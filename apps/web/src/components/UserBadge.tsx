import type { PublicUser } from '../api/types';
import { formatDate } from '../lib/format';
import { KycBadge } from './KycBadge';

export function Stars({ value }: { value: number }) {
  const full = Math.round(value);
  return (
    <span className="stars" aria-label={`${value.toFixed(1)} out of 5 stars`}>
      {'★★★★★'.slice(0, full)}
      <span className="stars-empty">{'★★★★★'.slice(full)}</span>
    </span>
  );
}

export function UserBadge({ user, role }: { user: PublicUser; role?: string }) {
  const initials = user.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
  return (
    <div className="user-badge">
      <span className="avatar" aria-hidden="true">
        {initials || '?'}
      </span>
      <div className="user-badge-body">
        <div className="user-badge-name">
          <strong>{user.name}</strong>
          {role && <span className="muted small"> · {role}</span>}
        </div>
        <div className="user-badge-meta">
          <KycBadge status={user.kycStatus} compact />
          <span className="badge badge-neutral" title="Trust score">
            Trust {Math.round(user.trustScore)}
          </span>
          {user.ratingAvg !== null && user.ratingCount > 0 ? (
            <span className="rating">
              <Stars value={user.ratingAvg} /> <span className="small muted">({user.ratingCount})</span>
            </span>
          ) : (
            <span className="small muted">No reviews yet</span>
          )}
        </div>
        <div className="small muted">Member since {formatDate(user.memberSince)}</div>
      </div>
    </div>
  );
}
