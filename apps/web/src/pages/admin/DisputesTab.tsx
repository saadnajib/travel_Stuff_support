import { useState } from 'react';
import { Link } from 'react-router-dom';
import { adminGetDisputes, adminResolveDispute } from '../../api/endpoints';
import type { AdminDispute, DisputeResolution } from '../../api/types';
import { EmptyState, ErrorState, Loading } from '../../components/Loading';
import { StatusPill } from '../../components/StatusPill';
import { useToast } from '../../components/Toast';
import { formatDateTime, formatMoney, humanize } from '../../lib/format';
import { useAsync } from '../../lib/useAsync';

const RESOLUTIONS: { value: DisputeResolution; label: string }[] = [
  { value: 'refund_sender', label: 'Refund sender' },
  { value: 'pay_traveler', label: 'Pay traveller' },
  { value: 'split', label: 'Split 50/50' },
];

function DisputeRow({ d, onResolved }: { d: AdminDispute; onResolved: (d: AdminDispute) => void }) {
  const toast = useToast();
  const [resolution, setResolution] = useState<DisputeResolution>('refund_sender');
  const [notes, setNotes] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const m = d.match;
  const openerName =
    d.openedBy === m.request.sender.id ? `${m.request.sender.name} (sender)` : d.openedBy === m.trip.traveler.id ? `${m.trip.traveler.name} (traveller)` : d.openedBy;

  const resolve = async () => {
    if (notes.trim().length < 5) {
      setError('Add notes explaining the decision.');
      return;
    }
    setError(null);
    setPending(true);
    try {
      const res = await adminResolveDispute(d.id, { resolution, notes: notes.trim() });
      onResolved({ ...res.dispute, match: res.match });
      toast.success('Dispute resolved.');
    } catch (e) {
      toast.error(e);
    } finally {
      setPending(false);
    }
  };

  return (
    <article className="card">
      <div className="row between wrap">
        <div>
          <strong>{d.reason}</strong>
          <div className="small muted">
            Opened by {openerName} · {formatDateTime(d.createdAt)}
          </div>
        </div>
        <StatusPill status={d.status} />
      </div>
      <p className="prewrap">{d.details}</p>
      <p className="small">
        Match: <Link to={`/matches/${m.id}`}>{m.request.title}</Link> · {m.trip.originCity} → {m.trip.destCity} · escrow{' '}
        {m.escrow ? `${humanize(m.escrow.status)} ${formatMoney(m.escrow.amountMinor, m.escrow.currency)}` : 'none'}
      </p>
      {d.status === 'resolved' ? (
        <p className="small">
          Resolved {formatDateTime(d.resolvedAt)}: <strong>{d.resolution ? humanize(d.resolution) : '—'}</strong>
          {d.adminNotes && <> — {d.adminNotes}</>}
        </p>
      ) : (
        <div className="form-grid">
          <div className="field">
            <label htmlFor={`res-${d.id}`}>Resolution</label>
            <select id={`res-${d.id}`} value={resolution} onChange={(e) => setResolution(e.target.value as DisputeResolution)}>
              {RESOLUTIONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field span-2">
            <label htmlFor={`notes-${d.id}`}>Notes</label>
            <textarea id={`notes-${d.id}`} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
            {error && <p className="field-error">{error}</p>}
          </div>
          <div>
            <button type="button" className="btn btn-sm" disabled={pending} onClick={() => void resolve()}>
              {pending ? 'Resolving…' : 'Resolve dispute'}
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

export function DisputesTab() {
  const [status, setStatus] = useState<'open' | 'resolved'>('open');
  const list = useAsync(() => adminGetDisputes(status), [status]);

  const onResolved = (d: AdminDispute) =>
    list.setData((prev) => (prev ?? []).map((x) => (x.id === d.id ? d : x)).filter((x) => status !== 'open' || x.status === 'open'));

  return (
    <div>
      <div className="row gap-1 section-tight">
        <label htmlFor="disp-status" className="small">
          Show
        </label>
        <select id="disp-status" value={status} onChange={(e) => setStatus(e.target.value as 'open' | 'resolved')} className="select-inline">
          <option value="open">Open disputes</option>
          <option value="resolved">Resolved disputes</option>
        </select>
      </div>
      {list.loading && <Loading />}
      {!!list.error && <ErrorState error={list.error} onRetry={list.reload} />}
      {list.data && list.data.length === 0 && <EmptyState title={`No ${status} disputes`} />}
      <div className="list">
        {list.data?.map((d) => (
          <DisputeRow key={d.id} d={d} onResolved={onResolved} />
        ))}
      </div>
    </div>
  );
}
