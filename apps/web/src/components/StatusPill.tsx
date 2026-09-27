import { humanize } from '../lib/format';

const TONE: Record<string, string> = {
  proposed: 'info',
  open: 'info',
  published: 'info',
  pending: 'warn',
  accepted: 'info',
  matched: 'info',
  funded: 'accent',
  held: 'accent',
  in_transit: 'accent',
  delivered: 'success',
  completed: 'success',
  released: 'success',
  verified: 'success',
  resolved: 'neutral',
  declined: 'neutral',
  cancelled: 'neutral',
  refunded: 'neutral',
  split: 'neutral',
  disputed: 'danger',
  rejected: 'danger',
  approved: 'success',
  auto_executed: 'accent',
  failed: 'danger',
};

export function StatusPill({ status }: { status: string }) {
  return <span className={`pill pill-${TONE[status] ?? 'neutral'}`}>{humanize(status)}</span>;
}
