import { useState } from 'react';
import { adminGetPendingKyc, adminKycDecision } from '../../api/endpoints';
import type { KycSubmission } from '../../api/types';
import { EmptyState, ErrorState, Loading } from '../../components/Loading';
import { useToast } from '../../components/Toast';
import { UserBadge } from '../../components/UserBadge';
import { countryName } from '../../lib/countries';
import { formatDateTime, humanize } from '../../lib/format';
import { useAsync } from '../../lib/useAsync';

function KycRow({ s, onDone }: { s: KycSubmission; onDone: (id: string) => void }) {
  const toast = useToast();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const decide = async (decision: 'approve' | 'reject') => {
    if (decision === 'reject' && reason.trim().length < 3) {
      setError('Give the user a reason so they can fix their submission.');
      return;
    }
    setError(null);
    setPending(true);
    try {
      await adminKycDecision(s.id, decision === 'reject' ? { decision, reason: reason.trim() } : { decision });
      toast.success(decision === 'approve' ? `${s.fullName} approved.` : `${s.fullName} rejected.`);
      onDone(s.id);
    } catch (e) {
      toast.error(e);
    } finally {
      setPending(false);
    }
  };

  return (
    <article className="card">
      <div className="row between wrap">
        <UserBadge user={s.user} />
        <span className="small muted">Submitted {formatDateTime(s.submittedAt)}</span>
      </div>
      <dl className="facts">
        <div>
          <dt>Full name</dt>
          <dd>{s.fullName}</dd>
        </div>
        <div>
          <dt>Document</dt>
          <dd>
            {humanize(s.docType)}
            {s.docNumberLast4 ? ` ••••${s.docNumberLast4}` : ''}
          </dd>
        </div>
        <div>
          <dt>Country</dt>
          <dd>{countryName(s.country)}</dd>
        </div>
        <div>
          <dt>File ref</dt>
          <dd className="mono small">{s.fileRef}</dd>
        </div>
      </dl>
      {rejecting && (
        <div className="field">
          <label htmlFor={`rej-${s.id}`}>Rejection reason</label>
          <input id={`rej-${s.id}`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
          {error && <p className="field-error">{error}</p>}
        </div>
      )}
      <div className="row gap-1 wrap">
        {!rejecting ? (
          <>
            <button type="button" className="btn btn-sm" disabled={pending} onClick={() => void decide('approve')}>
              Approve
            </button>
            <button type="button" className="btn btn-sm btn-danger" disabled={pending} onClick={() => setRejecting(true)}>
              Reject…
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn btn-sm btn-danger" disabled={pending} onClick={() => void decide('reject')}>
              Confirm reject
            </button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setRejecting(false)}>
              Cancel
            </button>
          </>
        )}
      </div>
    </article>
  );
}

export function KycTab() {
  const list = useAsync(adminGetPendingKyc, []);
  const remove = (id: string) => list.setData((prev) => (prev ?? []).filter((s) => s.id !== id));

  if (list.loading) return <Loading />;
  if (list.error) return <ErrorState error={list.error} onRetry={list.reload} />;
  if (!list.data?.length) return <EmptyState title="No pending KYC submissions">The queue is clear.</EmptyState>;
  return (
    <div className="list">
      {list.data.map((s) => (
        <KycRow key={s.id} s={s} onDone={remove} />
      ))}
    </div>
  );
}
