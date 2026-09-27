import { Link } from 'react-router-dom';
import { getMatches } from '../api/endpoints';
import { useAuth } from '../auth/AuthContext';
import { EmptyState, ErrorState, Loading } from '../components/Loading';
import { StatusPill } from '../components/StatusPill';
import { formatDate, formatMoney, humanize } from '../lib/format';
import { useAsync } from '../lib/useAsync';
import { groupMatches } from './Dashboard';

export function MatchesPage() {
  const { user } = useAuth();
  const matches = useAsync(getMatches, []);
  const groups = groupMatches(matches.data ?? []);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>My matches</h1>
          <p className="muted">Every delivery you're sending or carrying.</p>
        </div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void matches.reload()}>
          Refresh
        </button>
      </div>
      {matches.loading && !matches.data && <Loading />}
      {!!matches.error && <ErrorState error={matches.error} onRetry={matches.reload} />}
      {matches.data && groups.length === 0 && (
        <EmptyState
          title="No matches yet"
          action={
            <div className="row gap-1 wrap">
              <Link className="btn btn-sm" to="/trips">
                Find a traveller
              </Link>
              <Link className="btn btn-sm btn-secondary" to="/requests">
                Find requests to carry
              </Link>
            </div>
          }
        >
          Matches appear here once you ask a traveller or offer to carry a request.
        </EmptyState>
      )}
      {groups.map((g) => (
        <section key={g.status} className="section">
          <h2 className="row gap-1">
            {humanize(g.status)} <span className="count">{g.items.length}</span>
          </h2>
          <div className="list">
            {g.items.map((m) => {
              const role = m.request.sender.id === user?.id ? 'Sending' : 'Carrying';
              const other = role === 'Sending' ? m.trip.traveler : m.request.sender;
              return (
                <Link key={m.id} to={`/matches/${m.id}`} className="card list-row">
                  <div>
                    <strong>{m.request.title}</strong>
                    <div className="small muted">
                      {m.trip.originCity} → {m.trip.destCity} · departs {formatDate(m.trip.departDate)} · {role} with{' '}
                      {other.name}
                    </div>
                  </div>
                  <div className="list-row-end">
                    <span className="small">{formatMoney(m.agreedRewardMinor, m.currency)}</span>
                    <StatusPill status={m.status} />
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
