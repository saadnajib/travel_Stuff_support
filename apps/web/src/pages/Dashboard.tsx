import { Link } from 'react-router-dom';
import { getKycStatus, getMatches, getMyRequests, getMyTrips, opsGetProposals } from '../api/endpoints';
import type { Match, MatchStatus } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { VerificationBanners } from '../components/Banners';
import { KycBadge } from '../components/KycBadge';
import { EmptyState, ErrorState, Loading } from '../components/Loading';
import { StatusPill } from '../components/StatusPill';
import { formatDate, formatMoney, humanize, pluralize } from '../lib/format';
import { useAsync } from '../lib/useAsync';

export const MATCH_STATUS_ORDER: MatchStatus[] = [
  'proposed',
  'accepted',
  'funded',
  'in_transit',
  'delivered',
  'disputed',
  'completed',
  'resolved',
  'declined',
  'cancelled',
];

export function groupMatches(matches: Match[]): { status: MatchStatus; items: Match[] }[] {
  return MATCH_STATUS_ORDER.map((status) => ({ status, items: matches.filter((m) => m.status === status) })).filter(
    (g) => g.items.length > 0,
  );
}

export function DashboardPage() {
  const { user } = useAuth();
  const kyc = useAsync(getKycStatus, []);
  const trips = useAsync(getMyTrips, []);
  const requests = useAsync(getMyRequests, []);
  const matches = useAsync(getMatches, []);
  const isAdmin = user?.role === 'admin';
  // Errors are ignored on purpose: the card simply does not render if /ops is unavailable.
  const opsPending = useAsync(() => opsGetProposals({ status: 'pending' }), [isAdmin], isAdmin);

  if (!user) return null;
  const groups = groupMatches(matches.data ?? []);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Hi, {user.name.split(' ')[0]}</h1>
          <p className="muted">Here is everything happening on your account.</p>
        </div>
        <div className="row gap-1 wrap">
          <Link className="btn" to="/requests/new">
            Send something
          </Link>
          <Link className="btn btn-secondary" to="/trips/new">
            Post a trip
          </Link>
        </div>
      </div>

      {user.suspended && (
        <div className="alert alert-error">Your account is suspended. Contact support for help.</div>
      )}
      <VerificationBanners user={user} />

      {isAdmin && opsPending.data && (
        <Link to="/admin" className="card ops-callout">
          <span>
            <strong>AI Team:</strong> {pluralize(opsPending.data.length, 'approval')} waiting
          </span>
          <span className="small">Review →</span>
        </Link>
      )}

      <div className="grid grid-4 stats">
        <div className="card stat-card">
          <span className="stat-label">Email</span>
          <span className="stat-value">{user.emailVerified ? 'Verified' : 'Not verified'}</span>
          {!user.emailVerified && (
            <Link to="/verify-email" className="small">
              Verify now
            </Link>
          )}
        </div>
        <div className="card stat-card">
          <span className="stat-label">Identity (KYC)</span>
          <span className="stat-value">
            <KycBadge status={kyc.data?.kycStatus ?? user.kycStatus} />
          </span>
          <Link to="/kyc" className="small">
            {user.kycStatus === 'verified' ? 'View details' : 'Manage verification'}
          </Link>
          {kyc.data?.rejectionReason && <span className="small text-danger">{kyc.data.rejectionReason}</span>}
        </div>
        <div className="card stat-card">
          <span className="stat-label">Trust score</span>
          <span className="stat-value">{Math.round(user.trustScore)}</span>
          <span className="small muted">
            {user.ratingAvg !== null ? `${user.ratingAvg.toFixed(1)}★ from ${user.ratingCount}` : 'No reviews yet'}
          </span>
        </div>
        <div className="card stat-card">
          <span className="stat-label">Active matches</span>
          <span className="stat-value">
            {(matches.data ?? []).filter((m) => ['accepted', 'funded', 'in_transit', 'delivered'].includes(m.status)).length}
          </span>
          <Link to="/matches" className="small">
            View all
          </Link>
        </div>
      </div>

      <section className="section">
        <h2>My matches</h2>
        {matches.loading && <Loading />}
        {!!matches.error && <ErrorState error={matches.error} onRetry={matches.reload} />}
        {!matches.loading && !matches.error && groups.length === 0 && (
          <EmptyState title="No matches yet">
            Ask a traveller to carry your request, or offer to carry someone else's.
          </EmptyState>
        )}
        <div className="grid grid-3">
          {groups.map((g) => (
            <div key={g.status} className="card">
              <div className="row between">
                <h3>{humanize(g.status)}</h3>
                <span className="count">{g.items.length}</span>
              </div>
              <ul className="link-list">
                {g.items.slice(0, 5).map((m) => (
                  <li key={m.id}>
                    <Link to={`/matches/${m.id}`}>{m.request.title}</Link>
                    <span className="small muted">
                      {m.trip.originCity} → {m.trip.destCity} · {formatMoney(m.agreedRewardMinor, m.currency)}
                    </span>
                  </li>
                ))}
              </ul>
              {g.items.length > 5 && (
                <Link to="/matches" className="small">
                  +{g.items.length - 5} more
                </Link>
              )}
            </div>
          ))}
        </div>
      </section>

      <div className="grid grid-2 section">
        <section className="card">
          <div className="row between">
            <h2>My trips</h2>
            <Link to="/trips/new" className="small">
              + New trip
            </Link>
          </div>
          {trips.loading && <Loading />}
          {!!trips.error && <ErrorState error={trips.error} onRetry={trips.reload} />}
          {trips.data && trips.data.length === 0 && <EmptyState title="You haven't posted any trips." />}
          <ul className="link-list">
            {trips.data?.map((t) => (
              <li key={t.id}>
                <Link to={`/trips/${t.id}`}>
                  {t.originCity} → {t.destCity}
                </Link>
                <span className="row gap-1 small muted">
                  {formatDate(t.departDate)} <StatusPill status={t.status} />
                  {!t.verified && <span className="badge badge-neutral">Unverified booking</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>
        <section className="card">
          <div className="row between">
            <h2>My requests</h2>
            <Link to="/requests/new" className="small">
              + New request
            </Link>
          </div>
          {requests.loading && <Loading />}
          {!!requests.error && <ErrorState error={requests.error} onRetry={requests.reload} />}
          {requests.data && requests.data.length === 0 && <EmptyState title="You haven't posted any requests." />}
          <ul className="link-list">
            {requests.data?.map((r) => (
              <li key={r.id}>
                <Link to={`/requests/${r.id}`}>{r.title}</Link>
                <span className="row gap-1 small muted">
                  {r.originCity} → {r.destCity} <StatusPill status={r.status} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
