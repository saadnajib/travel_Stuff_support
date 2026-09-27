import type { Db } from '../db.js';
import { nowIso } from '../db.js';
import { audit } from '../lib/audit.js';
import { errors } from '../lib/errors.js';
import { bumpTrust, setMatchStatus } from '../routes/matches.js';
import type { PaymentProvider } from './payments.js';

/**
 * Privileged actions shared by the admin routes and by approved AI-team proposals.
 * `actorId` is always the human admin (or the proposal executor acting on their approval); these never run for `ops` callers directly.
 */
export interface ActionCtx {
  db: Db;
  payments: PaymentProvider;
  actorId: string;
  ip: string | null;
  via?: string; // e.g. 'proposal:<id>'
}

export function kycDecision(ctx: ActionCtx, submissionId: string, decision: 'approve' | 'reject', reason?: string): { userId: string; status: string } {
  const { db } = ctx;
  const sub = db.get(`SELECT * FROM kyc_submissions WHERE id = ?`, [submissionId]);
  if (!sub) throw errors.notFound('KYC submission');
  if (sub.status !== 'pending') throw errors.invalidState('This submission was already reviewed');
  if (decision === 'reject' && !reason) throw errors.validation([{ path: 'reason', message: 'A reason is required when rejecting' }]);
  const status = decision === 'approve' ? 'verified' : 'rejected';
  db.transaction(() => {
    db.run(`UPDATE kyc_submissions SET status = ?, rejection_reason = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?`, [status, reason ?? null, ctx.actorId, nowIso(), submissionId]);
    db.run(`UPDATE users SET kyc_status = ?, updated_at = ? WHERE id = ?`, [status, nowIso(), sub.user_id as string]);
  });
  audit(db, { actorId: ctx.actorId, action: `kyc.${decision}`, entity: 'kyc', entityId: submissionId, meta: { userId: sub.user_id, reason, via: ctx.via }, ip: ctx.ip });
  return { userId: sub.user_id as string, status };
}

export async function resolveDispute(ctx: ActionCtx, disputeId: string, resolution: 'refund_sender' | 'pay_traveler' | 'split', notes: string): Promise<{ matchId: string; escrowStatus: string | null }> {
  const { db, payments } = ctx;
  const dispute = db.get(`SELECT * FROM disputes WHERE id = ?`, [disputeId]);
  if (!dispute) throw errors.notFound('Dispute');
  if (dispute.status !== 'open') throw errors.invalidState('Dispute already resolved');
  const match = db.get(`SELECT * FROM matches WHERE id = ?`, [dispute.match_id as string])!;
  const escrow = db.get(`SELECT * FROM escrows WHERE match_id = ?`, [match.id as string]);

  let escrowStatus: 'refunded' | 'released' | 'split' | null = null;
  if (escrow && escrow.status === 'held') {
    const amount = escrow.amount_minor as number;
    if (resolution === 'refund_sender') {
      await payments.refund(escrow.provider_ref as string, amount + (escrow.fee_minor as number));
      escrowStatus = 'refunded';
    } else if (resolution === 'pay_traveler') {
      await payments.release(escrow.provider_ref as string, match.traveler_id as string, amount);
      escrowStatus = 'released';
    } else {
      const half = Math.floor(amount / 2);
      await payments.release(escrow.provider_ref as string, match.traveler_id as string, half);
      await payments.refund(escrow.provider_ref as string, amount - half);
      escrowStatus = 'split';
    }
  }

  db.transaction(() => {
    db.run(`UPDATE disputes SET status = 'resolved', resolution = ?, admin_notes = ?, resolved_by = ?, resolved_at = ? WHERE id = ?`, [resolution, notes, ctx.actorId, nowIso(), disputeId]);
    if (escrowStatus && escrow) db.run(`UPDATE escrows SET status = ?, released_at = ? WHERE id = ?`, [escrowStatus, nowIso(), escrow.id as string]);
    setMatchStatus(db, match.id as string, 'resolved', ctx.actorId);
    const requestStatus = resolution === 'refund_sender' ? 'cancelled' : 'completed';
    db.run(`UPDATE requests SET status = ?, updated_at = ? WHERE id = ?`, [requestStatus, nowIso(), match.request_id as string]);
    if (resolution === 'refund_sender') bumpTrust(db, match.traveler_id as string, -10);
    if (resolution === 'pay_traveler') bumpTrust(db, match.sender_id as string, -10);
  });
  audit(db, { actorId: ctx.actorId, action: 'dispute.resolve', entity: 'dispute', entityId: disputeId, meta: { resolution, escrowStatus, via: ctx.via }, ip: ctx.ip });
  return { matchId: match.id as string, escrowStatus };
}

export function suspendUser(ctx: ActionCtx, userId: string, suspended: boolean, reason: string): { userId: string; suspended: boolean } {
  const { db } = ctx;
  const user = db.get(`SELECT * FROM users WHERE id = ?`, [userId]);
  if (!user) throw errors.notFound('User');
  if (user.id === ctx.actorId) throw errors.conflict('You cannot suspend yourself');
  if (user.role === 'admin') throw errors.forbidden('Admin accounts cannot be suspended through this action');
  db.transaction(() => {
    db.run(`UPDATE users SET suspended = ?, suspended_reason = ?, updated_at = ? WHERE id = ?`, [suspended ? 1 : 0, suspended ? reason : null, nowIso(), userId]);
    if (suspended) db.run(`UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?`, [userId]);
  });
  audit(db, { actorId: ctx.actorId, action: suspended ? 'user.suspend' : 'user.unsuspend', entity: 'user', entityId: userId, meta: { reason, via: ctx.via }, ip: ctx.ip });
  return { userId, suspended };
}
