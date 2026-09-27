import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { nowIso } from '../db.js';
import type { PaymentProvider } from '../domain/payments.js';
import { audit } from '../lib/audit.js';
import { errors } from '../lib/errors.js';
import { publicUser, serializeDispute, serializeMatch, serializeUser, userRatings } from '../lib/serialize.js';
import { parse } from '../lib/validate.js';
import { assertUser, requireAdmin } from '../plugins/auth.js';
import { bumpTrust, setMatchStatus } from './matches.js';

const kycDecisionSchema = z.object({ decision: z.enum(['approve', 'reject']), reason: z.string().trim().max(500).optional() });
const resolveSchema = z.object({ resolution: z.enum(['refund_sender', 'pay_traveler', 'split']), notes: z.string().trim().min(5).max(3000) });
const suspendSchema = z.object({ suspended: z.boolean(), reason: z.string().trim().min(3).max(500) });

export async function adminRoutes(app: FastifyInstance, opts: { payments: PaymentProvider }): Promise<void> {
  app.addHook('preHandler', requireAdmin);

  app.get('/admin/kyc/pending', async () => {
    const rows = app.db.all(`SELECT * FROM kyc_submissions WHERE status = 'pending' ORDER BY submitted_at ASC LIMIT 200`);
    return {
      submissions: rows.map((r) => ({
        id: r.id,
        user: publicUser(app.db, r.user_id as string),
        docType: r.doc_type,
        docNumberLast4: r.doc_number_last4,
        fullName: r.full_name,
        dateOfBirth: r.date_of_birth,
        country: r.country,
        fileRef: r.file_ref,
        submittedAt: r.submitted_at,
      })),
    };
  });

  app.post('/admin/kyc/:id/decision', async (req) => {
    const admin = assertUser(req);
    const { id } = req.params as { id: string };
    const body = parse(kycDecisionSchema, req.body);
    const sub = app.db.get(`SELECT * FROM kyc_submissions WHERE id = ?`, [id]);
    if (!sub) throw errors.notFound('KYC submission');
    if (sub.status !== 'pending') throw errors.invalidState('This submission was already reviewed');
    if (body.decision === 'reject' && !body.reason) throw errors.validation([{ path: 'reason', message: 'A reason is required when rejecting' }]);
    const status = body.decision === 'approve' ? 'verified' : 'rejected';
    app.db.transaction(() => {
      app.db.run(`UPDATE kyc_submissions SET status = ?, rejection_reason = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?`, [status, body.reason ?? null, admin.id, nowIso(), id]);
      app.db.run(`UPDATE users SET kyc_status = ?, updated_at = ? WHERE id = ?`, [status, nowIso(), sub.user_id as string]);
    });
    audit(app.db, { actorId: admin.id, action: `kyc.${body.decision}`, entity: 'kyc', entityId: id, meta: { userId: sub.user_id, reason: body.reason }, ip: req.ip });
    return { ok: true };
  });

  app.get('/admin/disputes', async (req) => {
    const { status } = parse(z.object({ status: z.enum(['open', 'resolved']).default('open') }), req.query);
    const rows = app.db.all(`SELECT * FROM disputes WHERE status = ? ORDER BY created_at ASC LIMIT 200`, [status]);
    return {
      disputes: rows.map((d) => ({
        ...serializeDispute(d),
        match: serializeMatch(app.db, app.db.get(`SELECT * FROM matches WHERE id = ?`, [d.match_id as string])!),
      })),
    };
  });

  app.post('/admin/disputes/:id/resolve', async (req) => {
    const admin = assertUser(req);
    const { id } = req.params as { id: string };
    const body = parse(resolveSchema, req.body);
    const dispute = app.db.get(`SELECT * FROM disputes WHERE id = ?`, [id]);
    if (!dispute) throw errors.notFound('Dispute');
    if (dispute.status !== 'open') throw errors.invalidState('Dispute already resolved');
    const match = app.db.get(`SELECT * FROM matches WHERE id = ?`, [dispute.match_id as string])!;
    const escrow = app.db.get(`SELECT * FROM escrows WHERE match_id = ?`, [match.id as string]);

    let escrowStatus: 'refunded' | 'released' | 'split' | null = null;
    if (escrow && escrow.status === 'held') {
      const amount = escrow.amount_minor as number;
      if (body.resolution === 'refund_sender') {
        await opts.payments.refund(escrow.provider_ref as string, amount + (escrow.fee_minor as number));
        escrowStatus = 'refunded';
      } else if (body.resolution === 'pay_traveler') {
        await opts.payments.release(escrow.provider_ref as string, match.traveler_id as string, amount);
        escrowStatus = 'released';
      } else {
        const half = Math.floor(amount / 2);
        await opts.payments.release(escrow.provider_ref as string, match.traveler_id as string, half);
        await opts.payments.refund(escrow.provider_ref as string, amount - half);
        escrowStatus = 'split';
      }
    }

    app.db.transaction(() => {
      app.db.run(`UPDATE disputes SET status = 'resolved', resolution = ?, admin_notes = ?, resolved_by = ?, resolved_at = ? WHERE id = ?`, [body.resolution, body.notes, admin.id, nowIso(), id]);
      if (escrowStatus && escrow) app.db.run(`UPDATE escrows SET status = ?, released_at = ? WHERE id = ?`, [escrowStatus, nowIso(), escrow.id as string]);
      setMatchStatus(app.db, match.id as string, 'resolved', admin.id);
      const requestStatus = body.resolution === 'refund_sender' ? 'cancelled' : 'completed';
      app.db.run(`UPDATE requests SET status = ?, updated_at = ? WHERE id = ?`, [requestStatus, nowIso(), match.request_id as string]);
      if (body.resolution === 'refund_sender') bumpTrust(app.db, match.traveler_id as string, -10);
      if (body.resolution === 'pay_traveler') bumpTrust(app.db, match.sender_id as string, -10);
    });
    audit(app.db, { actorId: admin.id, action: 'dispute.resolve', entity: 'dispute', entityId: id, meta: { resolution: body.resolution, escrowStatus }, ip: req.ip });
    return {
      dispute: serializeDispute(app.db.get(`SELECT * FROM disputes WHERE id = ?`, [id])!),
      match: serializeMatch(app.db, app.db.get(`SELECT * FROM matches WHERE id = ?`, [match.id as string])!),
    };
  });

  app.get('/admin/users', async (req) => {
    const { q } = parse(z.object({ q: z.string().trim().max(100).default('') }), req.query);
    const rows = q
      ? app.db.all(`SELECT * FROM users WHERE email LIKE ? OR name LIKE ? ORDER BY created_at DESC LIMIT 100`, [`%${q}%`, `%${q}%`])
      : app.db.all(`SELECT * FROM users ORDER BY created_at DESC LIMIT 100`);
    return { users: rows.map((r) => serializeUser(r, userRatings(app.db, r.id as string))) };
  });

  app.post('/admin/users/:id/suspend', async (req) => {
    const admin = assertUser(req);
    const { id } = req.params as { id: string };
    const body = parse(suspendSchema, req.body);
    const user = app.db.get(`SELECT * FROM users WHERE id = ?`, [id]);
    if (!user) throw errors.notFound('User');
    if (user.id === admin.id) throw errors.conflict('You cannot suspend yourself');
    app.db.transaction(() => {
      app.db.run(`UPDATE users SET suspended = ?, suspended_reason = ?, updated_at = ? WHERE id = ?`, [body.suspended ? 1 : 0, body.suspended ? body.reason : null, nowIso(), id]);
      if (body.suspended) app.db.run(`UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?`, [id]);
    });
    audit(app.db, { actorId: admin.id, action: body.suspended ? 'user.suspend' : 'user.unsuspend', entity: 'user', entityId: id, meta: { reason: body.reason }, ip: req.ip });
    return { user: serializeUser(app.db.get(`SELECT * FROM users WHERE id = ?`, [id])!, userRatings(app.db, id)) };
  });

  app.get('/admin/audit', async (req) => {
    const { limit, before } = parse(z.object({ limit: z.coerce.number().int().min(1).max(500).default(100), before: z.string().max(40).optional() }), req.query);
    const rows = before
      ? app.db.all(`SELECT * FROM audit_log WHERE created_at < ? ORDER BY id DESC LIMIT ?`, [before, limit])
      : app.db.all(`SELECT * FROM audit_log ORDER BY id DESC LIMIT ?`, [limit]);
    return {
      entries: rows.map((r) => ({
        id: r.id,
        actorId: r.actor_id,
        action: r.action,
        entity: r.entity,
        entityId: r.entity_id,
        meta: r.meta ? JSON.parse(r.meta as string) : null,
        ip: r.ip,
        createdAt: r.created_at,
      })),
    };
  });
}
