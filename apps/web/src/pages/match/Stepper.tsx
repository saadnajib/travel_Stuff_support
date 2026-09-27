import type { Match, MatchStatus } from '../../api/types';
import { formatDateTime, humanize } from '../../lib/format';

const STEPS: { status: MatchStatus; label: string }[] = [
  { status: 'proposed', label: 'Proposed' },
  { status: 'accepted', label: 'Accepted' },
  { status: 'funded', label: 'Funded' },
  { status: 'in_transit', label: 'In transit' },
  { status: 'delivered', label: 'Delivered' },
  { status: 'completed', label: 'Completed' },
];

const OFF_PATH: MatchStatus[] = ['declined', 'cancelled', 'disputed', 'resolved'];

export function Stepper({ match }: { match: Match }) {
  const stepIndex = (s: MatchStatus) => STEPS.findIndex((x) => x.status === s);
  const reachedAt = new Map<MatchStatus, string>();
  match.timeline.forEach((t) => {
    if (!reachedAt.has(t.status)) reachedAt.set(t.status, t.at);
  });
  if (!reachedAt.has('proposed')) reachedAt.set('proposed', match.createdAt);

  const offPath = OFF_PATH.includes(match.status);
  // Furthest main-path step reached, using the timeline (for off-path states) or the current status.
  let current = stepIndex(match.status);
  if (current === -1) {
    current = 0;
    match.timeline.forEach((t) => {
      current = Math.max(current, stepIndex(t.status));
    });
  }

  return (
    <div className="stepper-wrap">
      <ol className="stepper" aria-label="Delivery progress">
        {STEPS.map((s, i) => {
          const state = i < current || (i === current && match.status === 'completed') ? 'done' : i === current ? (offPath ? 'halted' : 'current') : 'todo';
          return (
            <li key={s.status} className={`step step-${state}`} aria-current={state === 'current' ? 'step' : undefined}>
              <span className="step-dot" aria-hidden="true">
                {state === 'done' ? '✓' : i + 1}
              </span>
              <span className="step-label">{s.label}</span>
              {reachedAt.get(s.status) && <span className="step-time">{formatDateTime(reachedAt.get(s.status))}</span>}
            </li>
          );
        })}
      </ol>
      {offPath && (
        <p className={`stepper-note ${match.status === 'disputed' ? 'text-danger' : 'muted'}`}>
          This match is <strong>{humanize(match.status)}</strong>
          {reachedAt.get(match.status) ? ` since ${formatDateTime(reachedAt.get(match.status))}` : ''}.
        </p>
      )}
    </div>
  );
}
