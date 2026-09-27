import type { DisputeResolution, Proposal, ProposalKind, ProposalRisk } from '../../api/types';

export const KIND_ORDER: ProposalKind[] = ['kyc_decision', 'dispute_resolution', 'user_suspension', 'outreach_draft', 'report'];

export const KIND_LABEL: Record<ProposalKind, string> = {
  kyc_decision: 'KYC decision',
  dispute_resolution: 'Dispute resolution',
  user_suspension: 'User suspension',
  outreach_draft: 'Outreach draft',
  report: 'Report',
};

export const KIND_GROUP_LABEL: Record<ProposalKind, string> = {
  kyc_decision: 'KYC decisions',
  dispute_resolution: 'Dispute resolutions',
  user_suspension: 'User suspensions',
  outreach_draft: 'Outreach drafts',
  report: 'Reports',
};

export const RISK_TONE: Record<ProposalRisk, string> = {
  low: 'pill-success',
  medium: 'pill-warn',
  high: 'pill-danger',
};

export const RESOLUTION_LABEL: Record<DisputeResolution, string> = {
  refund_sender: 'Refund sender',
  pay_traveler: 'Pay traveller',
  split: 'Split 50/50',
};

export function resolutionLabel(r: string): string {
  return r in RESOLUTION_LABEL ? RESOLUTION_LABEL[r as DisputeResolution] : r;
}

/** Confidence (0..1) as a whole percentage, clamped. */
export function confidencePct(confidence: number): number {
  if (!Number.isFinite(confidence)) return 0;
  return Math.max(0, Math.min(100, Math.round(confidence * 100)));
}

export function byNewest(a: Proposal, b: Proposal): number {
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

export type ContextTarget = { type: 'user'; id: string } | { type: 'match'; id: string };

/** Which context (if any) a proposal can be inspected against. */
export function contextTarget(p: Proposal): ContextTarget | null {
  switch (p.kind) {
    case 'kyc_decision': {
      const u = p.payload.userId ?? p.payload.user;
      const id = typeof u === 'string' ? u : u && typeof u.id === 'string' ? u.id : null;
      return id ? { type: 'user', id } : null;
    }
    case 'user_suspension': {
      const id = typeof p.payload.userId === 'string' && p.payload.userId ? p.payload.userId : p.targetId;
      return id ? { type: 'user', id } : null;
    }
    case 'dispute_resolution':
      return typeof p.payload.matchId === 'string' && p.payload.matchId ? { type: 'match', id: p.payload.matchId } : null;
    default:
      return null;
  }
}

function compactJson(value: unknown, max = 160): string {
  let s: string;
  try {
    s = typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    return '';
  }
  if (!s) return '';
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Pulls a human-readable error out of a failed execution result (shape not fixed by the contract). */
export function executionError(result: Record<string, unknown> | null): string {
  if (!result) return 'Unknown error';
  const err = result.error;
  if (typeof err === 'string' && err) return err;
  if (err && typeof err === 'object') {
    const msg = (err as Record<string, unknown>).message;
    if (typeof msg === 'string' && msg) return msg;
    return compactJson(err);
  }
  if (typeof result.message === 'string' && result.message) return result.message;
  return compactJson(result) || 'Unknown error';
}

/** One-line summary of executionResult for history rows. */
export function executionSummary(p: Proposal): string {
  if (p.status === 'failed') return `Error: ${executionError(p.executionResult)}`;
  if (!p.executionResult) return '';
  return compactJson(p.executionResult);
}

/** Plain-language description of what approving will do, shown in the confirm modal. */
export function approveEffect(p: Proposal): string {
  switch (p.kind) {
    case 'kyc_decision':
      return p.payload.decision === 'approve'
        ? `This will APPROVE KYC submission ${p.payload.submissionId} now. The user becomes identity-verified and can post trips and requests.`
        : `This will REJECT KYC submission ${p.payload.submissionId} now${p.payload.reason ? ` with the reason "${p.payload.reason}"` : ''}. The user can resubmit.`;
    case 'user_suspension':
      return p.payload.suspended
        ? `This will SUSPEND user ${p.payload.userId} now. They will be blocked from using CarryLink until reinstated. Reason: "${p.payload.reason}".`
        : `This will REINSTATE (unsuspend) user ${p.payload.userId} now. Reason: "${p.payload.reason}".`;
    case 'dispute_resolution':
      return `This will resolve dispute ${p.payload.disputeId} as "${resolutionLabel(p.payload.resolution)}" now and move the escrow funds accordingly.`;
    case 'outreach_draft':
      return 'Nothing is posted automatically. Approving marks this draft as ready to post.';
    case 'report':
      return 'Approving acknowledges the report. Nothing is executed.';
    default:
      return '';
  }
}
