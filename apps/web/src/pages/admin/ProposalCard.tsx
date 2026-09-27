import { useId, useState, type ReactNode } from 'react';
import type { Proposal } from '../../api/types';
import { CopyButton } from '../../components/CopyButton';
import { formatDateTime, humanize } from '../../lib/format';
import { KIND_LABEL, RISK_TONE, approveEffect, confidencePct, contextTarget, resolutionLabel, type ContextTarget } from './proposalUtils';

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------

export function RiskBadge({ risk }: { risk: Proposal['risk'] }) {
  return <span className={`pill ${RISK_TONE[risk] ?? 'pill-neutral'}`}>{humanize(risk)} risk</span>;
}

export function ConfidenceBar({ confidence }: { confidence: number }) {
  const pct = confidencePct(confidence);
  return (
    <div className="confidence">
      <span className="confidence-label">Confidence</span>
      <span className="confidence-track" role="img" aria-label={`Confidence ${pct}%`}>
        <span className="confidence-fill" style={{ width: `${pct}%` }} />
      </span>
      <span className="confidence-value">{pct}%</span>
    </div>
  );
}

/** Clamps long content to a fixed height with a Show more / Show less toggle. */
function Collapsible({ children, long }: { children: ReactNode; long: boolean }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  if (!long) return <>{children}</>;
  return (
    <div>
      <div id={id} className={open ? 'collapsible' : 'collapsible clamped'}>
        {children}
      </div>
      <button type="button" className="link-btn small" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        {open ? 'Show less' : 'Show more'}
      </button>
    </div>
  );
}

function isLong(text: string, chars = 360, lines = 6): boolean {
  return text.length > chars || text.split('\n').length > lines;
}

// ---------------------------------------------------------------------------
// Minimal markdown: #/## headings, "- " bullets, paragraphs. Everything else is plain text.
// ---------------------------------------------------------------------------

type MdBlock = { type: 'h1' | 'h2' | 'p'; text: string } | { type: 'ul'; items: string[] };

export function parseMarkdownLite(md: string): MdBlock[] {
  const blocks: MdBlock[] = [];
  let para: string[] = [];
  let items: string[] = [];
  const flushPara = () => {
    if (para.length) blocks.push({ type: 'p', text: para.join('\n') });
    para = [];
  };
  const flushList = () => {
    if (items.length) blocks.push({ type: 'ul', items });
    items = [];
  };

  for (const raw of md.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }
    const heading = /^\s*(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushPara();
      flushList();
      blocks.push({ type: heading[1].length === 1 ? 'h1' : 'h2', text: heading[2].replace(/\s+#+\s*$/, '') });
      continue;
    }
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      flushPara();
      items.push(bullet[1]);
      continue;
    }
    if (items.length && /^\s+/.test(line)) {
      // Indented continuation of the previous bullet.
      items[items.length - 1] += ` ${line.trim()}`;
      continue;
    }
    flushList();
    para.push(line.trim());
  }
  flushPara();
  flushList();
  return blocks;
}

export function MarkdownLite({ markdown }: { markdown: string }) {
  const blocks = parseMarkdownLite(markdown);
  return (
    <div className="md-lite">
      {blocks.map((b, i) => {
        switch (b.type) {
          case 'h1':
            return (
              <h3 key={i} className="md-h1">
                {b.text}
              </h3>
            );
          case 'h2':
            return (
              <h4 key={i} className="md-h2">
                {b.text}
              </h4>
            );
          case 'ul':
            return (
              <ul key={i}>
                {b.items.map((it, j) => (
                  <li key={j}>{it}</li>
                ))}
              </ul>
            );
          default:
            return (
              <p key={i} className="prewrap">
                {b.text}
              </p>
            );
        }
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Payload rendering per kind
// ---------------------------------------------------------------------------

function Kv({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="kv">
      {rows.map(([k, v]) => (
        <div key={k} className="kv-row">
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function text(v: unknown): string {
  return typeof v === 'string' && v.trim() ? v : '—';
}

export function PayloadView({ p }: { p: Proposal }) {
  switch (p.kind) {
    case 'kyc_decision':
      return (
        <Kv
          rows={[
            [
              'Decision',
              <span className={`pill ${p.payload.decision === 'approve' ? 'pill-success' : 'pill-danger'}`}>
                {p.payload.decision === 'approve' ? 'Approve KYC' : 'Reject KYC'}
              </span>,
            ],
            ['Reason', <span className="prewrap">{text(p.payload.reason)}</span>],
            ['Submission', <span className="mono small">{text(p.payload.submissionId)}</span>],
          ]}
        />
      );
    case 'dispute_resolution':
      return (
        <Kv
          rows={[
            ['Resolution', <strong>{resolutionLabel(p.payload.resolution)}</strong>],
            ['Notes', <span className="prewrap">{text(p.payload.notes)}</span>],
            ['Dispute', <span className="mono small">{text(p.payload.disputeId)}</span>],
          ]}
        />
      );
    case 'user_suspension':
      return (
        <Kv
          rows={[
            [
              'Action',
              <span className={`pill ${p.payload.suspended ? 'pill-danger' : 'pill-success'}`}>
                {p.payload.suspended ? 'Suspend user' : 'Unsuspend user'}
              </span>,
            ],
            ['Reason', <span className="prewrap">{text(p.payload.reason)}</span>],
            ['User', <span className="mono small">{text(p.payload.userId ?? p.targetId)}</span>],
          ]}
        />
      );
    case 'outreach_draft':
      return (
        <div>
          <Kv
            rows={[
              ['Channel', humanize(text(p.payload.channel))],
              ['Audience', text(p.payload.audience)],
            ]}
          />
          <div className="copy-box-wrap">
            <pre className="copy-box">{p.payload.text ?? ''}</pre>
            <div className="copy-box-actions">
              <CopyButton value={p.payload.text ?? ''} label="Copy text" />
            </div>
          </div>
        </div>
      );
    case 'report': {
      const md = typeof p.payload.markdown === 'string' ? p.payload.markdown : '';
      return (
        <div>
          <Kv rows={[['Period', text(p.payload.period)]]} />
          <div className="report-box">
            <Collapsible long={isLong(md, 900, 18)}>
              <MarkdownLite markdown={md} />
            </Collapsible>
          </div>
        </div>
      );
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Inbox card
// ---------------------------------------------------------------------------

interface CardProps {
  p: Proposal;
  busy: boolean;
  onApprove: (p: Proposal) => void;
  onReject: (p: Proposal) => void;
  onContext: (target: ContextTarget, p: Proposal) => void;
}

export function ProposalCard({ p, busy, onApprove, onReject, onContext }: CardProps) {
  const ctx = contextTarget(p);
  const reasoning = p.reasoning ?? '';
  return (
    <article className="card proposal-card" aria-labelledby={`prop-${p.id}`}>
      <div className="proposal-head">
        <h4 id={`prop-${p.id}`} className="proposal-title">
          {p.title}
        </h4>
        <RiskBadge risk={p.risk} />
      </div>
      <div className="tags">
        <span className="badge badge-agent" title="Agent">
          {p.agent}
        </span>
        <span className="tag">{KIND_LABEL[p.kind] ?? humanize(p.kind)}</span>
        <span className="small muted">{formatDateTime(p.createdAt)}</span>
      </div>
      <ConfidenceBar confidence={p.confidence} />
      <div className="proposal-section">
        <span className="label">Reasoning</span>
        <Collapsible long={isLong(reasoning)}>
          <p className="prewrap proposal-reasoning">{reasoning || '—'}</p>
        </Collapsible>
      </div>
      <div className="proposal-section">
        <PayloadView p={p} />
      </div>
      <div className="card-actions">
        <button type="button" className="btn btn-sm" disabled={busy} onClick={() => onApprove(p)}>
          Approve
        </button>
        <button type="button" className="btn btn-sm btn-secondary" disabled={busy} onClick={() => onReject(p)}>
          Reject
        </button>
        {ctx && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => onContext(ctx, p)}>
            Context
          </button>
        )}
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Decide modal body (approve / reject)
// ---------------------------------------------------------------------------

export function DecisionSummary({ p, decision }: { p: Proposal; decision: 'approve' | 'reject' }) {
  if (decision === 'reject') {
    return (
      <p>
        Rejecting <strong>{p.title}</strong> discards the proposal from <strong>{p.agent}</strong>. Nothing is executed.
      </p>
    );
  }
  const executes = p.kind === 'kyc_decision' || p.kind === 'user_suspension' || p.kind === 'dispute_resolution';
  return (
    <>
      <p>
        <strong>{p.title}</strong> <span className="muted">· proposed by {p.agent}</span>
      </p>
      <div className={executes ? 'alert alert-warn' : 'alert alert-info'} role="note">
        <span>
          {executes && <strong>What will be executed: </strong>}
          {approveEffect(p)}
        </span>
      </div>
    </>
  );
}
