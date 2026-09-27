import { Link } from 'react-router-dom';
import { opsGetMatchContext, opsGetUserContext } from '../../api/endpoints';
import type { AuditEntry, MatchContext, UserContext } from '../../api/types';
import { KycBadge } from '../../components/KycBadge';
import { EmptyState, ErrorState, Loading } from '../../components/Loading';
import { Modal } from '../../components/Modal';
import { StatusPill } from '../../components/StatusPill';
import { formatDateTime, formatMoney, humanize } from '../../lib/format';
import { useAsync } from '../../lib/useAsync';
import type { ContextTarget } from './proposalUtils';
import { resolutionLabel } from './proposalUtils';

const COUNT_LABELS: [keyof UserContext['counts'], string][] = [
  ['trips', 'Trips'],
  ['requests', 'Requests'],
  ['matchesCompleted', 'Matches completed'],
  ['matchesDisputed', 'Matches disputed'],
  ['disputesOpenedByUser', 'Disputes opened'],
  ['disputesLostByUser', 'Disputes lost'],
  ['redactedMessages30d', 'Redacted msgs (30d)'],
  ['codeFailures30d', 'Code failures (30d)'],
];

function AuditTable({ entries }: { entries: AuditEntry[] }) {
  if (entries.length === 0) return <p className="small muted">No recent audit entries.</p>;
  return (
    <div className="table-wrap ctx-table">
      <table className="table table-compact">
        <thead>
          <tr>
            <th>When</th>
            <th>Action</th>
            <th>Entity</th>
          </tr>
        </thead>
        <tbody>
          {entries.slice(0, 15).map((e) => (
            <tr key={e.id}>
              <td className="nowrap">{formatDateTime(e.createdAt)}</td>
              <td>
                <code>{e.action}</code>
              </td>
              <td className="small">{e.entity}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UserContextView({ ctx, heading }: { ctx: UserContext; heading?: string }) {
  const u = ctx.user;
  return (
    <section className="ctx-section">
      {heading && <h3 className="ctx-heading">{heading}</h3>}
      <div className="row between wrap">
        <div className="ctx-user">
          <strong>{u.name}</strong>
          <div className="small muted break">{u.email}</div>
        </div>
        <div className="row gap-1 wrap">
          <KycBadge status={u.kycStatus} compact />
          {u.suspended ? <span className="pill pill-danger">Suspended</span> : <span className="pill pill-success">Active</span>}
          {u.role !== 'user' && <span className="badge badge-neutral">{u.role}</span>}
        </div>
      </div>
      <p className="small muted">
        Trust {Math.round(u.trustScore)} · {u.ratingAvg !== null ? `${u.ratingAvg.toFixed(1)}★ (${u.ratingCount})` : 'no reviews'} · joined{' '}
        {formatDateTime(u.createdAt)}
      </p>
      {ctx.kyc && (
        <p className="small">
          KYC: <strong>{humanize(ctx.kyc.status)}</strong> · {humanize(ctx.kyc.docType)} · {ctx.kyc.country} · {ctx.kyc.fullName} ·
          submitted {formatDateTime(ctx.kyc.submittedAt)}
        </p>
      )}
      <dl className="facts ctx-counts">
        {COUNT_LABELS.map(([key, label]) => (
          <div key={key}>
            <dt>{label}</dt>
            <dd>{ctx.counts?.[key] ?? '—'}</dd>
          </div>
        ))}
      </dl>
      <span className="label">Recent audit</span>
      <AuditTable entries={ctx.recentAudit ?? []} />
    </section>
  );
}

function MatchContextView({ ctx }: { ctx: MatchContext }) {
  const m = ctx.match;
  const redacted = ctx.messages.filter((x) => x.redacted).length;
  const recent = ctx.messages.slice(-5);
  const partyName = (id: string) =>
    id === ctx.sender.user.id ? ctx.sender.user.name : id === ctx.traveler.user.id ? ctx.traveler.user.name : 'Unknown';
  return (
    <>
      <section className="ctx-section">
        <div className="row between wrap">
          <Link to={`/matches/${m.id}`}>
            <strong>{m.request.title}</strong>
          </Link>
          <StatusPill status={m.status} />
        </div>
        <p className="small muted">
          {m.trip.originCity} → {m.trip.destCity} · reward {formatMoney(m.agreedRewardMinor, m.currency)} · escrow{' '}
          {m.escrow ? `${humanize(m.escrow.status)} ${formatMoney(m.escrow.amountMinor, m.escrow.currency)}` : 'none'}
        </p>
        <dl className="facts ctx-counts">
          <div>
            <dt>Messages</dt>
            <dd>{ctx.messages.length}</dd>
          </div>
          <div>
            <dt>Redacted</dt>
            <dd>{redacted}</dd>
          </div>
          <div>
            <dt>Disputes</dt>
            <dd>{ctx.disputes.length}</dd>
          </div>
        </dl>
        {ctx.disputes.length > 0 && (
          <>
            <span className="label">Disputes</span>
            <ul className="plain-list ctx-list">
              {ctx.disputes.map((d) => (
                <li key={d.id}>
                  <div className="row between wrap">
                    <strong className="small">{d.reason}</strong>
                    <StatusPill status={d.status} />
                  </div>
                  <p className="small prewrap">{d.details}</p>
                  <p className="small muted">
                    Opened by {partyName(d.openedBy)} · {formatDateTime(d.createdAt)}
                    {d.resolution && <> · {resolutionLabel(d.resolution)}</>}
                  </p>
                </li>
              ))}
            </ul>
          </>
        )}
        {recent.length > 0 && (
          <>
            <span className="label">Latest messages</span>
            <ul className="plain-list ctx-list">
              {recent.map((msg) => (
                <li key={msg.id} className="small">
                  <span className="muted">
                    {partyName(msg.senderId)} · {formatDateTime(msg.createdAt)}
                    {msg.redacted && ' · redacted'}
                  </span>
                  <div className="prewrap">{msg.body}</div>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
      <UserContextView ctx={ctx.sender} heading="Sender" />
      <UserContextView ctx={ctx.traveler} heading="Traveller" />
    </>
  );
}

function UserContextLoader({ id }: { id: string }) {
  const q = useAsync(() => opsGetUserContext(id), [id]);
  if (q.loading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} onRetry={q.reload} />;
  if (!q.data) return <EmptyState title="No context available" />;
  return <UserContextView ctx={q.data} />;
}

function MatchContextLoader({ id }: { id: string }) {
  const q = useAsync(() => opsGetMatchContext(id), [id]);
  if (q.loading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} onRetry={q.reload} />;
  if (!q.data) return <EmptyState title="No context available" />;
  return <MatchContextView ctx={q.data} />;
}

export function OpsContextModal({ target, title, onClose }: { target: ContextTarget; title: string; onClose: () => void }) {
  return (
    <Modal title={target.type === 'user' ? `User context: ${title}` : `Match context: ${title}`} onClose={onClose}>
      {target.type === 'user' ? <UserContextLoader id={target.id} /> : <MatchContextLoader id={target.id} />}
    </Modal>
  );
}
