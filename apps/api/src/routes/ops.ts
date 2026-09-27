import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { config } from '../config.js';
import type { Db, Row } from '../db.js';
import { nowIso } from '../db.js';
import { kycDecision, resolveDispute, suspendUser } from '../domain/adminActions.js';
import type { PaymentProvider } from '../domain/payments.js';
import { audit } from '../lib/audit.js';
import { AppError, errors } from '../lib/errors.js';
import { serializeDispute, serializeMatch, serializeUser, userRatings } from '../lib/serialize.js';
import { parse } from '../lib/validate.js';
import { assertUser, requireAdmin, requireStaff } from '../plugins/auth.js';
import { serializeAudit } from './admin.js';

const KINDS = ['kyc_decision', 'dispute_resolution', 'user_suspension', 'outreach_draft', 'report'] as const;
const STATUSES = ['pending', 'approved', 'rejected', 'auto_executed', 'failed'] as const;

const payloadSchemas = {
  kyc_decision: z.object({ submissionId: z.string().min(1), userId: z.string().optional(), decision: z.enum(['approve', 'reject']), reason: z.string().trim().max(500).optional() }),
  dispute_resolution: z.object({ disputeId: z.string().min(1), matchId: z.string().optional(), resolution: z.enum(['refund_sender', 'pay_traveler', 'split']), notes: z.string().trim().min(5).max(3000) }),
  user_suspension: z.object({ userId: z.string().min(1), suspended: z.boolean(), reason: z.string().trim().min(3).max(500) }),
  outreach_draft: z.object({ channel: z.enum(['whatsapp', 'email', 'other']), audience: z.string().trim().min(2).max(200), text: z.string().trim().min(10).max(4000) }),
  report: z.object({ period: z.string().trim().min(2).max(60), markdown: z.string().trim().min(10).max(20000) }),
};

const createSchema = z.object({
  agent: z.string().trim().min(2).max(60),
  kind: z.enum(KINDS),
  targetId: z.string().max(80).optional(),
  title: z.string().trim().min(3).max(200),
  reasoning: z.string().trim().min(10).max(6000),
  confidence: z.number().min(0).max(1),
  risk: z.enum(['low', 'medium', 'high']),
  payload: z.record(z.unknown()),
});

function serializeProposal(row: Row) {
  return {
    id: row.id,
    agent: row.agent,
    kind: row.kind,
    targetId: row.target_id ?? null,
    title: row.title,
    reasoning: row.reasoning,
    confidence: row.confidence,
    risk: row.risk,
    payload: JSON.parse(row.payload as string),
    status: row.status,
    autoPolicy: row.auto_policy ?? null,
    proposedBy: row.proposed_by ?? null,
    decidedBy: row.decided_by ?? null,
    decidedAt: row.decided_at ?? null,
    decisionNote: row.decision_note ?? null,
    executionResult: row.execution_result ? JSON.parse(row.execution_result as string) : null,
    createdAt: row.created_at,
  };
}

/** Decide, server side, whether a proposal may run without a human. Returns the policy name or null. */
function autoPolicyFor(db: Db, kind: (typeof KINDS)[number], payload: Record<string, unknown>, confidence: number, risk: string): string | null {
  if (!config.ops.autoExecute) return null;
  if (risk !== 'low' || confidence < config.ops.autoMinConfidence) return null;
  if (kind === 'kyc_decision' && payload.decision === 'reject') return 'auto_reject_kyc';
  if (kind === 'dispute_resolution') {
    const d = db.get(`SELECT match_id FROM disputes WHERE id = ?`, [String(payload.disputeId)]);
    if (!d) return null;
    const e = db.get(`SELECT amount_minor FROM escrows WHERE match_id = ?`, [d.match_id as string]);
    const amount = (e?.amount_minor as number | undefined) ?? Number.POSITIVE_INFINITY;
    if (amount <= config.ops.autoDisputeMaxMinor) return `auto_small_dispute_le_${config.ops.autoDisputeMaxMinor}`;
  }
  return null;
}

async function execute(app: FastifyInstance, payments: PaymentProvider, row: Row, actorId: string, ip: string | null): Promise<unknown> {
  const kind = row.kind as (typeof KINDS)[number];
  const payload = JSON.parse(row.payload as string);
  const ctx = { db: app.db, payments, actorId, ip, via: `proposal:${row.id}` };
  switch (kind) {
    case 'kyc_decision': {
      const p = payloadSchemas.kyc_decision.parse(payload);
      return kycDecision(ctx, p.submissionId, p.decision, p.reason);
    }
    case 'dispute_resolution': {
      const p = payloadSchemas.dispute_resolution.parse(payload);
      return resolveDispute(ctx, p.disputeId, p.resolution, p.notes);
    }
    case 'user_suspension': {
      const p = payloadSchemas.user_suspension.parse(payload);
      return suspendUser(ctx, p.userId, p.suspended, p.reason);
    }
    default:
      return { noop: true };
  }
}

function userContext(db: Db, userId: string) {
  const user = db.get(`SELECT * FROM users WHERE id = ?`, [userId]);
  if (!user) throw errors.notFound('User');
  const kyc = db.get(`SELECT status, doc_type, country, full_name, submitted_at FROM kyc_submissions WHERE user_id = ? ORDER BY submitted_at DESC LIMIT 1`, [userId]);
  const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const count = (sql: string, params: (string | number)[]) => db.get<{ c: number }>(sql, params)!.c;
  return {
    user: serializeUser(user, userRatings(db, userId)),
    kyc: kyc ? { status: kyc.status, docType: kyc.doc_type, country: kyc.country, fullName: kyc.full_name, submittedAt: kyc.submitted_at } : null,
    counts: {
      trips: count(`SELECT COUNT(*) c FROM trips WHERE traveler_id = ?`, [userId]),
      requests: count(`SELECT COUNT(*) c FROM requests WHERE sender_id = ?`, [userId]),
      matchesCompleted: count(`SELECT COUNT(*) c FROM matches WHERE (sender_id = ? OR traveler_id = ?) AND status = 'completed'`, [userId, userId]),
      matchesDisputed: count(`SELECT COUNT(*) c FROM matches m JOIN disputes d ON d.match_id = m.id WHERE m.sender_id = ? OR m.traveler_id = ?`, [userId, userId]),
      disputesOpenedByUser: count(`SELECT COUNT(*) c FROM disputes WHERE opened_by = ?`, [userId]),
      disputesLostByUser: count(
        `SELECT COUNT(*) c FROM disputes d JOIN matches m ON m.id = d.match_id
         WHERE d.status = 'resolved' AND ((d.resolution = 'refund_sender' AND m.traveler_id = ?) OR (d.resolution = 'pay_traveler' AND m.sender_id = ?))`,
        [userId, userId],
      ),
      redactedMessages30d: count(`SELECT COUNT(*) c FROM messages WHERE sender_id = ? AND redacted = 1 AND created_at > ?`, [userId, since30]),
      codeFailures30d: count(`SELECT COUNT(*) c FROM audit_log WHERE actor_id = ? AND action = 'match.code_failed' AND created_at > ?`, [userId, since30]),
    },
    recentAudit: db.all(`SELECT * FROM audit_log WHERE actor_id = ? OR entity_id = ? ORDER BY id DESC LIMIT 30`, [userId, userId]).map(serializeAudit),
  };
}

export async function opsRoutes(app: FastifyInstance, opts: { payments: PaymentProvider }): Promise<void> {
  app.post('/ops/proposals', { preHandler: requireStaff, config: { rateLimit: { max: 120, timeWindow: '15 minutes' } } }, async (req, reply) => {
    const actor = assertUser(req);
    const body = parse(createSchema, req.body);
    const payload = parse(payloadSchemas[body.kind], body.payload);
    const targetId =
      body.targetId ??
      (body.kind === 'kyc_decision' ? (payload as { submissionId: string }).submissionId
        : body.kind === 'dispute_resolution' ? (payload as { disputeId: string }).disputeId
        : body.kind === 'user_suspension' ? (payload as { userId: string }).userId
        : null);
    if (targetId) {
      const dup = app.db.get(`SELECT id FROM ops_proposals WHERE kind = ? AND target_id = ? AND status IN ('pending','approved','auto_executed')`, [body.kind, targetId]);
      if (dup) throw errors.conflict('A proposal for this target already exists');
    }
    const id = randomUUID();
    const policy = autoPolicyFor(app.db, body.kind, payload as Record<string, unknown>, body.confidence, body.risk);
    app.db.run(
      `INSERT INTO ops_proposals (id, agent, kind, target_id, title, reasoning, confidence, risk, payload, status, auto_policy, proposed_by, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,'pending',?,?,?)`,
      [id, body.agent, body.kind, targetId, body.title, body.reasoning, body.confidence, body.risk, JSON.stringify(payload), policy, actor.id, nowIso()],
    );
    audit(app.db, { actorId: actor.id, action: 'ops.propose', entity: 'proposal', entityId: id, meta: { agent: body.agent, kind: body.kind, targetId, policy }, ip: req.ip });

    if (policy) {
      const row = app.db.get(`SELECT * FROM ops_proposals WHERE id = ?`, [id])!;
      try {
        // Auto-executed actions are attributed to the proposing service account, with the policy recorded.
        const result = await execute(app, opts.payments, row, actor.id, req.ip);
        app.db.run(`UPDATE ops_proposals SET status = 'auto_executed', decided_by = NULL, decided_at = ?, execution_result = ? WHERE id = ?`, [nowIso(), JSON.stringify(result), id]);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        app.db.run(`UPDATE ops_proposals SET status = 'failed', decided_at = ?, execution_result = ? WHERE id = ?`, [nowIso(), JSON.stringify({ error: msg }), id]);
      }
    }
    return reply.code(201).send({ proposal: serializeProposal(app.db.get(`SELECT * FROM ops_proposals WHERE id = ?`, [id])!) });
  });

  app.get('/ops/proposals', { preHandler: requireStaff }, async (req) => {
    const q = parse(z.object({ status: z.enum([...STATUSES, 'all']).default('pending'), kind: z.enum(KINDS).optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }), req.query);
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (q.status !== 'all') { where.push('status = ?'); params.push(q.status); }
    if (q.kind) { where.push('kind = ?'); params.push(q.kind); }
    const rows = app.db.all(`SELECT * FROM ops_proposals ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT ?`, [...params, q.limit]);
    return { proposals: rows.map(serializeProposal) };
  });

  app.get('/ops/proposals/:id', { preHandler: requireStaff }, async (req) => {
    const row = app.db.get(`SELECT * FROM ops_proposals WHERE id = ?`, [(req.params as { id: string }).id]);
    if (!row) throw errors.notFound('Proposal');
    return { proposal: serializeProposal(row) };
  });

  app.post('/ops/proposals/:id/decide', { preHandler: requireAdmin }, async (req) => {
    const admin = assertUser(req);
    const { id } = req.params as { id: string };
    const body = parse(z.object({ decision: z.enum(['approve', 'reject']), note: z.string().trim().max(2000).optional() }), req.body);
    const row = app.db.get(`SELECT * FROM ops_proposals WHERE id = ?`, [id]);
    if (!row) throw errors.notFound('Proposal');
    if (row.status !== 'pending') throw errors.invalidState(`Proposal is already ${row.status}`);
    if (body.decision === 'reject') {
      app.db.run(`UPDATE ops_proposals SET status = 'rejected', decided_by = ?, decided_at = ?, decision_note = ? WHERE id = ?`, [admin.id, nowIso(), body.note ?? null, id]);
    } else {
      try {
        const result = await execute(app, opts.payments, row, admin.id, req.ip);
        app.db.run(`UPDATE ops_proposals SET status = 'approved', decided_by = ?, decided_at = ?, decision_note = ?, execution_result = ? WHERE id = ?`, [admin.id, nowIso(), body.note ?? null, JSON.stringify(result), id]);
      } catch (e) {
        const msg = e instanceof AppError ? `${e.code}: ${e.message}` : e instanceof Error ? e.message : String(e);
        app.db.run(`UPDATE ops_proposals SET status = 'failed', decided_by = ?, decided_at = ?, decision_note = ?, execution_result = ? WHERE id = ?`, [admin.id, nowIso(), body.note ?? null, JSON.stringify({ error: msg }), id]);
      }
    }
    audit(app.db, { actorId: admin.id, action: `ops.${body.decision}`, entity: 'proposal', entityId: id, meta: { kind: row.kind, note: body.note }, ip: req.ip });
    return { proposal: serializeProposal(app.db.get(`SELECT * FROM ops_proposals WHERE id = ?`, [id])!) };
  });

  app.get('/ops/stats', { preHandler: requireStaff }, async () => {
    const db = app.db;
    const one = (sql: string, params: (string | number)[] = []) => Number(db.get<{ c: number | null }>(sql, params)?.c ?? 0);
    const since7 = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const byStatus: Record<string, number> = {};
    for (const r of db.all<{ status: string; c: number }>(`SELECT status, COUNT(*) c FROM matches GROUP BY status`)) byStatus[r.status] = r.c;
    const reqStatus = (s: string) => one(`SELECT COUNT(*) c FROM requests WHERE status = ?`, [s]);
    return {
      users: {
        total: one(`SELECT COUNT(*) c FROM users WHERE role = 'user'`),
        verified: one(`SELECT COUNT(*) c FROM users WHERE role = 'user' AND kyc_status = 'verified'`),
        pendingKyc: one(`SELECT COUNT(*) c FROM kyc_submissions WHERE status = 'pending'`),
        suspended: one(`SELECT COUNT(*) c FROM users WHERE suspended = 1`),
      },
      trips: { published: one(`SELECT COUNT(*) c FROM trips WHERE status = 'published'`), verified: one(`SELECT COUNT(*) c FROM trips WHERE status = 'published' AND verified = 1`) },
      requests: { open: reqStatus('open'), matched: reqStatus('matched'), inTransit: reqStatus('in_transit'), delivered: reqStatus('delivered'), completed: reqStatus('completed'), disputed: reqStatus('disputed'), cancelled: reqStatus('cancelled') },
      matches: { byStatus },
      escrow: {
        heldMinor: one(`SELECT SUM(amount_minor) c FROM escrows WHERE status = 'held'`),
        releasedMinor: one(`SELECT SUM(amount_minor) c FROM escrows WHERE status = 'released'`),
        refundedMinor: one(`SELECT SUM(amount_minor) c FROM escrows WHERE status = 'refunded'`),
        feesEarnedMinor: one(`SELECT SUM(fee_minor) c FROM escrows WHERE status IN ('released','split')`),
      },
      disputes: { open: one(`SELECT COUNT(*) c FROM disputes WHERE status = 'open'`), resolved: one(`SELECT COUNT(*) c FROM disputes WHERE status = 'resolved'`) },
      last7d: {
        newUsers: one(`SELECT COUNT(*) c FROM users WHERE created_at > ?`, [since7]),
        newRequests: one(`SELECT COUNT(*) c FROM requests WHERE created_at > ?`, [since7]),
        newTrips: one(`SELECT COUNT(*) c FROM trips WHERE created_at > ?`, [since7]),
        matchesProposed: one(`SELECT COUNT(*) c FROM matches WHERE created_at > ?`, [since7]),
        matchesCompleted: one(`SELECT COUNT(*) c FROM match_events WHERE status = 'completed' AND at > ?`, [since7]),
        disputesOpened: one(`SELECT COUNT(*) c FROM disputes WHERE created_at > ?`, [since7]),
        redactedMessages: one(`SELECT COUNT(*) c FROM messages WHERE redacted = 1 AND created_at > ?`, [since7]),
        codeFailures: one(`SELECT COUNT(*) c FROM audit_log WHERE action = 'match.code_failed' AND created_at > ?`, [since7]),
      },
      proposals: {
        pending: one(`SELECT COUNT(*) c FROM ops_proposals WHERE status = 'pending'`),
        autoExecuted7d: one(`SELECT COUNT(*) c FROM ops_proposals WHERE status = 'auto_executed' AND created_at > ?`, [since7]),
      },
      policy: config.ops,
    };
  });

  app.get('/ops/context/match/:id', { preHandler: requireStaff }, async (req) => {
    const { id } = req.params as { id: string };
    const row = app.db.get(`SELECT * FROM matches WHERE id = ?`, [id]);
    if (!row) throw errors.notFound('Match');
    const messages = app.db.all(`SELECT * FROM messages WHERE match_id = ? ORDER BY created_at ASC LIMIT 300`, [id]);
    return {
      match: serializeMatch(app.db, row),
      messages: messages.map((m) => ({ id: m.id, senderId: m.sender_id, body: m.body, redacted: m.redacted === 1, createdAt: m.created_at })),
      disputes: app.db.all(`SELECT * FROM disputes WHERE match_id = ? ORDER BY created_at ASC`, [id]).map(serializeDispute),
      sender: userContext(app.db, row.sender_id as string),
      traveler: userContext(app.db, row.traveler_id as string),
    };
  });

  app.get('/ops/context/user/:id', { preHandler: requireStaff }, async (req) => ({ user: userContext(app.db, (req.params as { id: string }).id) }));
}
