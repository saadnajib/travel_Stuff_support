import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { kycDecision, resolveDispute, suspendUser } from '../domain/adminActions.js';
import type { PaymentProvider } from '../domain/payments.js';
import { publicUser, serializeDispute, serializeMatch, serializeUser, userRatings } from '../lib/serialize.js';
import { parse } from '../lib/validate.js';
import { assertUser, requireAdmin, requireStaff } from '../plugins/auth.js';

const kycDecisionSchema = z.object({ decision: z.enum(['approve', 'reject']), reason: z.string().trim().max(500).optional() });
const resolveSchema = z.object({ resolution: z.enum(['refund_sender', 'pay_traveler', 'split']), notes: z.string().trim().min(5).max(3000) });
const suspendSchema = z.object({ suspended: z.boolean(), reason: z.string().trim().min(3).max(500) });

export async function adminRoutes(app: FastifyInstance, opts: { payments: PaymentProvider }): Promise<void> {
  // Reads are open to the AI operations role; every write stays admin-only.
  app.addHook('preHandler', async (req, reply) => {
    if (req.method === 'GET') await requireStaff(req, reply);
    else await requireAdmin(req, reply);
  });

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
    kycDecision({ db: app.db, payments: opts.payments, actorId: admin.id, ip: req.ip }, id, body.decision, body.reason);
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
    const { matchId } = await resolveDispute({ db: app.db, payments: opts.payments, actorId: admin.id, ip: req.ip }, id, body.resolution, body.notes);
    return {
      dispute: serializeDispute(app.db.get(`SELECT * FROM disputes WHERE id = ?`, [id])!),
      match: serializeMatch(app.db, app.db.get(`SELECT * FROM matches WHERE id = ?`, [matchId])!),
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
    suspendUser({ db: app.db, payments: opts.payments, actorId: admin.id, ip: req.ip }, id, body.suspended, body.reason);
    return { user: serializeUser(app.db.get(`SELECT * FROM users WHERE id = ?`, [id])!, userRatings(app.db, id)) };
  });

  app.get('/admin/audit', async (req) => {
    const { limit, before } = parse(z.object({ limit: z.coerce.number().int().min(1).max(500).default(100), before: z.string().max(40).optional() }), req.query);
    const rows = before
      ? app.db.all(`SELECT * FROM audit_log WHERE created_at < ? ORDER BY id DESC LIMIT ?`, [before, limit])
      : app.db.all(`SELECT * FROM audit_log ORDER BY id DESC LIMIT ?`, [limit]);
    return { entries: rows.map(serializeAudit) };
  });
}

export function serializeAudit(r: Record<string, unknown>) {
  return {
    id: r.id,
    actorId: r.actor_id,
    action: r.action,
    entity: r.entity,
    entityId: r.entity_id,
    meta: r.meta ? JSON.parse(r.meta as string) : null,
    ip: r.ip,
    createdAt: r.created_at,
  };
}
