import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { opsDecideProposal, opsGetProposals, opsGetStats } from '../../api/endpoints';
import type { OpsStats, Proposal, ProposalKind, ProposalStatus } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { EmptyState, ErrorState, Loading } from '../../components/Loading';
import { Modal } from '../../components/Modal';
import { StatusPill } from '../../components/StatusPill';
import { useToast } from '../../components/Toast';
import { errorMessage } from '../../api/client';
import { formatDateTime, formatMoney, formatTime, humanize } from '../../lib/format';
import { useAsync } from '../../lib/useAsync';
import { OpsContextModal } from './OpsContextModal';
import { DecisionSummary, ProposalCard, RiskBadge } from './ProposalCard';
import {
  KIND_GROUP_LABEL,
  KIND_LABEL,
  KIND_ORDER,
  byNewest,
  executionError,
  executionSummary,
  type ContextTarget,
} from './proposalUtils';

const REFRESH_MS = 30_000;
const HISTORY_LIMIT = 50;

type HistoryFilter = Exclude<ProposalStatus, 'pending'> | 'all';
const HISTORY_FILTERS: { value: HistoryFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'auto_executed', label: 'Auto-executed' },
  { value: 'failed', label: 'Failed' },
];

// ---------------------------------------------------------------------------
// KPI strip
// ---------------------------------------------------------------------------

function Kpis({ stats }: { stats: OpsStats }) {
  const items: { label: string; value: string | number; sub?: string }[] = [
    {
      label: 'Pending approvals',
      value: stats.proposals?.pending ?? 0,
      sub: `${stats.proposals?.autoExecuted7d ?? 0} auto-executed (7d)`,
    },
    { label: 'Open disputes', value: stats.disputes?.open ?? 0 },
    { label: 'KYC backlog', value: stats.users?.pendingKyc ?? 0 },
    // The stats contract has no currency field; escrow totals are shown in the platform default (USD).
    { label: 'Escrow held', value: formatMoney(stats.escrow?.heldMinor ?? 0) },
    { label: 'Matches completed (7d)', value: stats.last7d?.matchesCompleted ?? 0 },
    { label: 'Disputes opened (7d)', value: stats.last7d?.disputesOpened ?? 0 },
  ];
  return (
    <div className="kpi-grid">
      {items.map((k) => (
        <div key={k.label} className="card stat-card kpi-card">
          <span className="stat-label">{k.label}</span>
          <span className="stat-value kpi-value">{k.value}</span>
          {k.sub && <span className="small muted">{k.sub}</span>}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Decide modal
// ---------------------------------------------------------------------------

interface Deciding {
  p: Proposal;
  decision: 'approve' | 'reject';
}

function DecideModal({
  deciding,
  onClose,
  onDecided,
  onFailed,
}: {
  deciding: Deciding;
  onClose: () => void;
  onDecided: (result: Proposal) => void;
  onFailed: () => void;
}) {
  const { p, decision } = deciding;
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const noteId = `decide-note-${p.id}`;
  // Stable identity so the Modal's focus effect does not re-run on every keystroke.
  const guardedClose = useCallback(() => {
    if (!pendingRef.current) onClose();
  }, [onClose]);

  const submit = async () => {
    const trimmed = note.trim();
    if (decision === 'reject' && trimmed.length < 3) {
      setError('A note is required when rejecting (at least 3 characters).');
      return;
    }
    setError(null);
    setRequestError(null);
    setPending(true);
    pendingRef.current = true;
    try {
      const result = await opsDecideProposal(p.id, { decision, note: trimmed || undefined });
      pendingRef.current = false;
      onDecided(result);
    } catch (e) {
      pendingRef.current = false;
      setPending(false);
      setRequestError(errorMessage(e));
      onFailed();
    }
  };

  const destructive = decision === 'reject' || (p.kind === 'user_suspension' && p.payload.suspended);
  const confirmLabel =
    decision === 'reject'
      ? 'Reject proposal'
      : p.kind === 'user_suspension'
        ? p.payload.suspended
          ? 'Approve and suspend user'
          : 'Approve and unsuspend user'
        : p.kind === 'kyc_decision'
          ? p.payload.decision === 'approve'
            ? 'Approve and verify user'
            : 'Approve and reject KYC'
          : p.kind === 'dispute_resolution'
            ? 'Approve and resolve dispute'
            : 'Approve';

  return (
    <Modal
      title={decision === 'approve' ? 'Approve proposal' : 'Reject proposal'}
      onClose={guardedClose}
      footer={
        <>
          <button type="button" className="btn btn-secondary" disabled={pending} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={destructive ? 'btn btn-danger' : 'btn'}
            disabled={pending}
            onClick={() => void submit()}
          >
            {pending ? 'Working…' : confirmLabel}
          </button>
        </>
      }
    >
      <DecisionSummary p={p} decision={decision} />
      {requestError && (
        <div className="alert alert-error" role="alert">
          {requestError}
        </div>
      )}
      <div className={`field${error ? ' has-error' : ''}`}>
        <label htmlFor={noteId}>{decision === 'reject' ? 'Note (required)' : 'Note (optional)'}</label>
        <textarea
          id={noteId}
          rows={3}
          maxLength={2000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          aria-invalid={!!error}
          aria-describedby={error ? `${noteId}-err` : undefined}
        />
        {error && (
          <p id={`${noteId}-err`} className="field-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}

function outcomeMessage(p: Proposal): { ok: boolean; message: string } {
  switch (p.status) {
    case 'approved':
      if (p.kind === 'outreach_draft') return { ok: true, message: 'Approved: draft marked ready to post.' };
      if (p.kind === 'report') return { ok: true, message: 'Report acknowledged.' };
      return { ok: true, message: `Approved and executed: ${p.title}` };
    case 'failed':
      return { ok: false, message: `Approved but execution failed: ${executionError(p.executionResult)}` };
    case 'rejected':
      return { ok: true, message: 'Proposal rejected.' };
    default:
      return { ok: true, message: `Proposal is now ${humanize(p.status)}.` };
  }
}

// ---------------------------------------------------------------------------
// Inbox
// ---------------------------------------------------------------------------

function groupByKind(proposals: Proposal[]): { kind: ProposalKind; items: Proposal[]; agents: [string, number][] }[] {
  const known = new Set<string>(KIND_ORDER);
  const kinds: ProposalKind[] = [...KIND_ORDER, ...new Set(proposals.map((p) => p.kind).filter((k) => !known.has(k)))];
  return kinds
    .map((kind) => {
      const items = proposals.filter((p) => p.kind === kind).sort(byNewest);
      const counts = new Map<string, number>();
      items.forEach((p) => counts.set(p.agent, (counts.get(p.agent) ?? 0) + 1));
      return { kind, items, agents: [...counts.entries()] };
    })
    .filter((g) => g.items.length > 0);
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

function HistoryList({ proposals, meId }: { proposals: Proposal[]; meId: string | undefined }) {
  return (
    <ul className="history-list card">
      {proposals.map((p) => {
        const summary = executionSummary(p);
        const who =
          p.status === 'auto_executed'
            ? 'auto-policy'
            : p.decidedBy
              ? p.decidedBy === meId
                ? 'you'
                : p.decidedBy
              : null;
        return (
          <li key={p.id} className="history-row">
            <div className="history-main">
              <div className="row between wrap history-title-row">
                <strong className="history-title">{p.title}</strong>
                <StatusPill status={p.status} />
              </div>
              <div className="tags history-tags">
                <span className="badge badge-agent">{p.agent}</span>
                <span className="tag">{KIND_LABEL[p.kind] ?? humanize(p.kind)}</span>
                <RiskBadge risk={p.risk} />
              </div>
              <p className="small muted history-meta">
                Proposed {formatDateTime(p.createdAt)}
                {who && (
                  <>
                    {' '}
                    · decided by <span className="break">{who}</span>
                  </>
                )}
                {p.decidedAt && <> {formatDateTime(p.decidedAt)}</>}
              </p>
              {p.autoPolicy && <p className="small history-meta">Auto-policy: {p.autoPolicy}</p>}
              {p.decisionNote && <p className="small history-meta prewrap">Note: {p.decisionNote}</p>}
              {summary && (
                <p className={`small mono history-result${p.status === 'failed' ? ' text-danger' : ''}`}>{summary}</p>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Tab
// ---------------------------------------------------------------------------

export function AiTeamTab() {
  const toast = useToast();
  const { user } = useAuth();
  const stats = useAsync(opsGetStats, []);
  const inbox = useAsync(() => opsGetProposals({ status: 'pending' }), []);
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>('all');
  const [historyKey, setHistoryKey] = useState(0);
  const history = useAsync(
    () => opsGetProposals({ status: historyFilter, limit: HISTORY_LIMIT }),
    [historyFilter, historyKey],
  );
  const [deciding, setDeciding] = useState<Deciding | null>(null);
  const [context, setContext] = useState<{ target: ContextTarget; title: string } | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  const reloadStats = stats.reload;
  const reloadInbox = inbox.reload;

  useEffect(() => {
    if (inbox.data) setUpdatedAt(new Date().toISOString());
  }, [inbox.data]);

  // Auto-refresh the inbox (and the KPI strip) every 30s while this tab is mounted and visible.
  useEffect(() => {
    const t = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      void reloadInbox();
      void reloadStats();
    }, REFRESH_MS);
    return () => window.clearInterval(t);
  }, [reloadInbox, reloadStats]);

  const refreshAll = useCallback(() => {
    void reloadInbox();
    void reloadStats();
    setHistoryKey((k) => k + 1);
  }, [reloadInbox, reloadStats]);

  const pending = useMemo(() => (inbox.data ?? []).filter((p) => p.status === 'pending'), [inbox.data]);
  const groups = useMemo(() => groupByKind(pending), [pending]);
  const past = useMemo(
    () => (history.data ?? []).filter((p) => p.status !== 'pending').sort(byNewest),
    [history.data],
  );

  const onDecided = (result: Proposal) => {
    setDeciding(null);
    const { ok, message } = outcomeMessage(result);
    if (ok) toast.success(message);
    else toast.error(message);
    refreshAll();
  };
  const closeDeciding = useCallback(() => setDeciding(null), []);
  const closeContext = useCallback(() => setContext(null), []);

  return (
    <div className="ai-team">
      <section aria-labelledby="ai-kpi-h">
        <h2 id="ai-kpi-h" className="sr-only">
          Key numbers
        </h2>
        {stats.loading && !stats.data && <Loading label="Loading stats…" />}
        {!!stats.error && !stats.data && <ErrorState error={stats.error} onRetry={stats.reload} />}
        {stats.data && <Kpis stats={stats.data} />}
      </section>

      <section className="section" aria-labelledby="ai-inbox-h">
        <div className="row between wrap section-tight">
          <h2 id="ai-inbox-h" className="inbox-heading">
            Approvals inbox <span className="count">{pending.length}</span>
          </h2>
          <div className="row gap-1">
            {updatedAt && <span className="small muted">Updated {formatTime(updatedAt)}</span>}
            <button type="button" className="btn btn-sm btn-secondary" disabled={inbox.loading} onClick={refreshAll}>
              {inbox.loading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>
        {inbox.loading && !inbox.data && <Loading />}
        {!!inbox.error && !inbox.data && <ErrorState error={inbox.error} onRetry={inbox.reload} />}
        {!!inbox.error && inbox.data && (
          <div className="alert alert-warn" role="status">
            Couldn't refresh the inbox: {errorMessage(inbox.error)}
          </div>
        )}
        {inbox.data && pending.length === 0 && (
          <EmptyState title="Nothing waiting for approval">The AI team's new proposals will appear here.</EmptyState>
        )}
        {groups.map((g) => (
          <div key={g.kind} className="proposal-group">
            <div className="proposal-group-head">
              <h3>
                {KIND_GROUP_LABEL[g.kind] ?? humanize(g.kind)} <span className="count">{g.items.length}</span>
              </h3>
              <div className="tags">
                {g.agents.map(([agent, n]) => (
                  <span key={agent} className="badge badge-agent" title={`${n} from ${agent}`}>
                    {agent} · {n}
                  </span>
                ))}
              </div>
            </div>
            <div className="list">
              {g.items.map((p) => (
                <ProposalCard
                  key={p.id}
                  p={p}
                  busy={deciding?.p.id === p.id}
                  onApprove={(x) => setDeciding({ p: x, decision: 'approve' })}
                  onReject={(x) => setDeciding({ p: x, decision: 'reject' })}
                  onContext={(target, x) => setContext({ target, title: x.title })}
                />
              ))}
            </div>
          </div>
        ))}
      </section>

      <section className="section" aria-labelledby="ai-history-h">
        <div className="row between wrap section-tight">
          <h2 id="ai-history-h">History</h2>
          <div className="row gap-1">
            <label htmlFor="ai-history-filter" className="small">
              Show
            </label>
            <select
              id="ai-history-filter"
              className="select-inline"
              value={historyFilter}
              onChange={(e) => setHistoryFilter(e.target.value as HistoryFilter)}
            >
              {HISTORY_FILTERS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        {history.loading && !history.data && <Loading />}
        {!!history.error && <ErrorState error={history.error} onRetry={history.reload} />}
        {history.data && past.length === 0 && <EmptyState title="No decided proposals yet" />}
        {past.length > 0 && <HistoryList proposals={past} meId={user?.id} />}
      </section>

      {deciding && (
        <DecideModal deciding={deciding} onClose={closeDeciding} onDecided={onDecided} onFailed={refreshAll} />
      )}
      {context && <OpsContextModal target={context.target} title={context.title} onClose={closeContext} />}
    </div>
  );
}
