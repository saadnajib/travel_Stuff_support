import type { FastifyInstance, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { config } from '../config.js';
import type { Db, Row } from '../db.js';
import { nowIso } from '../db.js';
import { computeFees } from '../domain/categories.js';
import type { PaymentProvider } from '../domain/payments.js';
import { audit } from '../lib/audit.js';
import { decryptField, encryptField, hmacHex, randomSixDigitCode, safeEqual } from '../lib/crypto.js';
import { AppError, errors } from '../lib/errors.js';
import { redactPii } from '../lib/redact.js';
import { serializeDispute, serializeMatch } from '../lib/serialize.js';
import { parse } from '../lib/validate.js';
import { assertUser, requireAuth, requireKyc } from '../plugins/auth.js';
import type { AuthUser } from '../types.js';

type Party = 'sender' | 'traveler' | 'admin';

const createSchema = z.object({ requestId: z.string().uuid(), tripId: z.string().uuid() });
const paySchema = z.object({ paymentMethodToken: z.string().min(4).max(80) });
const codeSchema = z.string().regex(/^\d{6}$/, 'Code must be 6 digits');
const handoverSchema = z.object({
  code: codeSchema,
  inspectionNotes: z.string().trim().min(5).max(2000),
  photoRefs: z.array(z.string().min(8).max(100)).min(1).max(10),
});
const deliverSchema = z.object({ code: codeSchema });
const disputeSchema = z.object({
  reason: z.enum(['item_not_as_declared', 'not_delivered', 'damaged', 'traveler_no_show', 'sender_no_show', 'suspected_prohibited', 'other']),
  details: z.string().trim().min(10).max(3000),
});
const reviewSchema = z.object({ rating: z.number().int().min(1).max(5), comment: z.string().trim().max(1000).default('') });
const messageSchema = z.object({ body: z.string().trim().min(1).max(2000) });

export function addEvent(db: Db, matchId: string, status: string, byUserId: string | null): void {
  db.run(`INSERT INTO match_events (match_id, status, by_user_id, at) VALUES (?,?,?,?)`, [matchId, status, byUserId, nowIso()]);
}

export function setMatchStatus(db: Db, matchId: string, status: string, byUserId: string | null, extraSql = '', extraParams: (string | number | null)[] = []): void {
  db.run(`UPDATE matches SET status = ?, updated_at = ?${extraSql} WHERE id = ?`, [status, nowIso(), ...extraParams, matchId]);
  addEvent(db, matchId, status, byUserId);
}

export function bumpTrust(db: Db, userId: string, delta: number): void {
  db.run(`UPDATE users SET trust_score = MAX(0, MIN(100, trust_score + ?)), updated_at = ? WHERE id = ?`, [delta, nowIso(), userId]);
}

/** Release escrow to the traveller and close the match. Used by sender confirmation and the dispute-window sweep. */
export async function completeMatch(db: Db, payments: PaymentProvider, matchId: string, byUserId: string | null, ip: string | null): Promise<void> {
  const row = db.get(`SELECT * FROM matches WHERE id = ?`, [matchId]);
  if (!row || row.status !== 'delivered') return;
  const escrow = db.get(`SELECT * FROM escrows WHERE match_id = ? AND status = 'held'`, [matchId]);
  if (escrow) await payments.release(escrow.provider_ref as string, row.traveler_id as string, escrow.amount_minor as number);
  db.transaction(() => {
    if (escrow) db.run(`UPDATE escrows SET status = 'released', released_at = ? WHERE id = ?`, [nowIso(), escrow.id as string]);
    setMatchStatus(db, matchId, 'completed', byUserId);
    db.run(`UPDATE requests SET status = 'completed', updated_at = ? WHERE id = ?`, [nowIso(), row.request_id as string]);
    bumpTrust(db, row.traveler_id as string, 3);
    bumpTrust(db, row.sender_id as string, 2);
  });
  audit(db, { actorId: byUserId, action: 'escrow.released', entity: 'match', entityId: matchId, meta: { amountMinor: escrow?.amount_minor ?? 0, auto: byUserId === null }, ip });
}

/** Auto-complete delivered matches whose dispute window has lapsed. Cheap; safe to call often. */
export async function sweepAutoComplete(db: Db, payments: PaymentProvider): Promise<number> {
  const cutoff = new Date(Date.now() - config.disputeWindowHours * 3_600_000).toISOString();
  const due = db.all(
    `SELECT m.id FROM matches m JOIN match_events e ON e.match_id = m.id AND e.status = 'delivered'
     WHERE m.status = 'delivered' AND e.at < ?`,
    [cutoff],
  );
  for (const r of due) await completeMatch(db, payments, r.id as string, null, null);
  return due.length;
}

export function loadMatch(db: Db, id: string, user: AuthUser): { row: Row; party: Party } {
  const row = db.get(`SELECT * FROM matches WHERE id = ?`, [id]);
  if (!row) throw errors.notFound('Match');
  if (row.sender_id === user.id) return { row, party: 'sender' };
  if (row.traveler_id === user.id) return { row, party: 'traveler' };
  if (user.role === 'admin') return { row, party: 'admin' };
  // Do not reveal existence to non-parties.
  throw errors.notFound('Match');
}

function assertStatus(row: Row, allowed: string[]): void {
  if (!allowed.includes(row.status as string)) {
    throw errors.invalidState(`This action is not available while the match is '${row.status}'`);
  }
}

export function openDispute(db: Db, matchId: string, openedBy: string, reason: string, details: string): Row {
  const match = db.get(`SELECT * FROM matches WHERE id = ?`, [matchId])!;
  const id = randomUUID();
  db.transaction(() => {
    db.run(
      `INSERT INTO disputes (id, match_id, opened_by, reason, details, status, created_at) VALUES (?,?,?,?,?,'open',?)`,
      [id, matchId, openedBy, reason, details, nowIso()],
    );
    setMatchStatus(db, matchId, 'disputed', openedBy === 'system' ? null : openedBy, ', status_before_dispute = ?', [match.status as string]);
    db.run(`UPDATE requests SET status = 'disputed', updated_at = ? WHERE id = ?`, [nowIso(), match.request_id as string]);
  });
  return db.get(`SELECT * FROM disputes WHERE id = ?`, [id])!;
}

function checkCode(app: FastifyInstance, req: FastifyRequest, row: Row, column: 'handover_code_hash' | 'delivery_code_hash', code: string): void {
  const expected = row[column] as string | null;
  const ok = expected !== null && safeEqual(hmacHex(`${row.id}:${column}:${code}`), expected);
  if (ok) {
    app.db.run(`UPDATE matches SET code_attempts = 0 WHERE id = ?`, [row.id as string]);
    return;
  }
  const attempts = (row.code_attempts as number) + 1;
  app.db.run(`UPDATE matches SET code_attempts = ? WHERE id = ?`, [attempts, row.id as string]);
  audit(app.db, { actorId: req.user?.id ?? null, action: 'match.code_failed', entity: 'match', entityId: row.id as string, meta: { column, attempts }, ip: req.ip });
  if (attempts >= config.codeMaxAttempts) {
    openDispute(app.db, row.id as string, 'system', 'other', `Automatic dispute: ${config.codeMaxAttempts} incorrect ${column === 'handover_code_hash' ? 'handover' : 'delivery'} code attempts.`);
    throw new AppError(423, 'MATCH_LOCKED', 'Too many incorrect codes. The match is locked and a dispute has been opened.');
  }
  throw errors.invalidCode(config.codeMaxAttempts - attempts);
}

export async function matchRoutes(app: FastifyInstance, opts: { payments: PaymentProvider }): Promise<void> {
  const { payments } = opts;

  app.post('/matches', { preHandler: requireKyc }, async (req, reply) => {
    const user = assertUser(req);
    const body = parse(createSchema, req.body);
    const request = app.db.get(`SELECT * FROM requests WHERE id = ?`, [body.requestId]);
    const trip = app.db.get(`SELECT * FROM trips WHERE id = ?`, [body.tripId]);
    if (!request) throw errors.notFound('Request');
    if (!trip) throw errors.notFound('Trip');

    let proposedBy: 'sender' | 'traveler';
    if (request.sender_id === user.id) proposedBy = 'sender';
    else if (trip.traveler_id === user.id) proposedBy = 'traveler';
    else throw errors.forbidden('You must own either the request or the trip');
    if (request.sender_id === trip.traveler_id) throw errors.conflict('You cannot carry your own request');

    if (request.status !== 'open') throw errors.invalidState('This request is no longer open');
    if (trip.status !== 'published') throw errors.invalidState('This trip is not available');
    if (trip.verified !== 1) throw errors.invalidState('Trips must be verified with a booking reference before matching');
    if (request.origin_country !== trip.origin_country || request.dest_country !== trip.dest_country) {
      throw errors.conflict('The trip route does not match the request route');
    }
    if ((trip.depart_date as string) > (request.needed_by_date as string)) throw errors.conflict('The trip departs after the request is needed');
    const allowed = JSON.parse(trip.allowed_categories as string) as string[];
    if (!allowed.includes(request.category as string)) throw errors.conflict('The traveller does not carry this category');

    const counterpart = app.db.get(`SELECT kyc_status, suspended FROM users WHERE id = ?`, [proposedBy === 'sender' ? (trip.traveler_id as string) : (request.sender_id as string)]);
    if (!counterpart || counterpart.kyc_status !== 'verified' || counterpart.suspended === 1) throw errors.conflict('The other party is not verified');

    const used = app.db.get<{ kg: number | null }>(
      `SELECT SUM(r.weight_kg) kg FROM matches m JOIN requests r ON r.id = m.request_id
       WHERE m.trip_id = ? AND m.status NOT IN ('proposed','declined','cancelled')`,
      [trip.id as string],
    );
    if ((used?.kg ?? 0) + (request.weight_kg as number) > (trip.capacity_kg as number)) throw errors.conflict('The trip does not have enough remaining capacity');

    const dup = app.db.get(`SELECT id FROM matches WHERE request_id = ? AND trip_id = ? AND status IN ('proposed','accepted','funded','in_transit','delivered','disputed')`, [request.id as string, trip.id as string]);
    if (dup) throw errors.conflict('A match between this request and trip already exists');

    const fees = computeFees(request.reward_minor as number);
    const id = randomUUID();
    const now = nowIso();
    app.db.transaction(() => {
      app.db.run(
        `INSERT INTO matches (id, request_id, trip_id, sender_id, traveler_id, proposed_by, status, agreed_reward_minor, platform_fee_minor, protection_fee_minor, currency, created_at, updated_at)
         VALUES (?,?,?,?,?,?,'proposed',?,?,?,?,?,?)`,
        [id, request.id as string, trip.id as string, request.sender_id as string, trip.traveler_id as string, proposedBy, request.reward_minor as number, fees.platformFeeMinor, fees.protectionFeeMinor, request.currency as string, now, now],
      );
      addEvent(app.db, id, 'proposed', user.id);
    });
    audit(app.db, { actorId: user.id, action: 'match.propose', entity: 'match', entityId: id, meta: { proposedBy }, ip: req.ip });
    return reply.code(201).send({ match: serializeMatch(app.db, app.db.get(`SELECT * FROM matches WHERE id = ?`, [id])!) });
  });

  app.get('/matches', { preHandler: requireAuth }, async (req) => {
    const user = assertUser(req);
    await sweepAutoComplete(app.db, payments);
    const rows = app.db.all(`SELECT * FROM matches WHERE sender_id = ? OR traveler_id = ? ORDER BY updated_at DESC`, [user.id, user.id]);
    return { matches: rows.map((r) => serializeMatch(app.db, r)) };
  });

  app.get('/matches/:id', { preHandler: requireAuth }, async (req) => {
    await sweepAutoComplete(app.db, payments);
    const { row } = loadMatch(app.db, (req.params as { id: string }).id, assertUser(req));
    return { match: serializeMatch(app.db, row) };
  });

  app.post('/matches/:id/accept', { preHandler: requireKyc }, async (req) => {
    const user = assertUser(req);
    const { row, party } = loadMatch(app.db, (req.params as { id: string }).id, user);
    assertStatus(row, ['proposed']);
    if (party === 'admin' || party === row.proposed_by) throw errors.forbidden('Only the other party can accept');
    const request = app.db.get(`SELECT status FROM requests WHERE id = ?`, [row.request_id as string])!;
    if (request.status !== 'open') throw errors.invalidState('This request is no longer open');
    app.db.transaction(() => {
      setMatchStatus(app.db, row.id as string, 'accepted', user.id);
      app.db.run(`UPDATE requests SET status = 'matched', updated_at = ? WHERE id = ?`, [nowIso(), row.request_id as string]);
      app.db.run(`UPDATE matches SET status = 'declined', updated_at = ? WHERE request_id = ? AND id != ? AND status = 'proposed'`, [nowIso(), row.request_id as string, row.id as string]);
    });
    audit(app.db, { actorId: user.id, action: 'match.accept', entity: 'match', entityId: row.id as string, ip: req.ip });
    return { match: serializeMatch(app.db, app.db.get(`SELECT * FROM matches WHERE id = ?`, [row.id as string])!) };
  });

  app.post('/matches/:id/decline', { preHandler: requireAuth }, async (req) => {
    const user = assertUser(req);
    const { row, party } = loadMatch(app.db, (req.params as { id: string }).id, user);
    assertStatus(row, ['proposed']);
    if (party === 'admin') throw errors.forbidden();
    setMatchStatus(app.db, row.id as string, 'declined', user.id);
    audit(app.db, { actorId: user.id, action: 'match.decline', entity: 'match', entityId: row.id as string, ip: req.ip });
    return { match: serializeMatch(app.db, app.db.get(`SELECT * FROM matches WHERE id = ?`, [row.id as string])!) };
  });

  app.post('/matches/:id/cancel', { preHandler: requireAuth }, async (req) => {
    const user = assertUser(req);
    const { row, party } = loadMatch(app.db, (req.params as { id: string }).id, user);
    assertStatus(row, ['proposed', 'accepted']);
    if (party === 'admin') throw errors.forbidden();
    app.db.transaction(() => {
      setMatchStatus(app.db, row.id as string, 'cancelled', user.id);
      if (row.status === 'accepted') app.db.run(`UPDATE requests SET status = 'open', updated_at = ? WHERE id = ?`, [nowIso(), row.request_id as string]);
    });
    audit(app.db, { actorId: user.id, action: 'match.cancel', entity: 'match', entityId: row.id as string, ip: req.ip });
    return { match: serializeMatch(app.db, app.db.get(`SELECT * FROM matches WHERE id = ?`, [row.id as string])!) };
  });

  app.post('/matches/:id/pay', { preHandler: requireKyc, config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (req) => {
    const user = assertUser(req);
    const { row, party } = loadMatch(app.db, (req.params as { id: string }).id, user);
    if (party !== 'sender') throw errors.forbidden('Only the sender pays into escrow');
    assertStatus(row, ['accepted']);
    const body = parse(paySchema, req.body);
    const fees = computeFees(row.agreed_reward_minor as number);
    let providerRef: string;
    try {
      ({ providerRef } = await payments.hold({ payerId: user.id, amountMinor: fees.totalChargeMinor, currency: row.currency as string, paymentMethodToken: body.paymentMethodToken }));
    } catch {
      audit(app.db, { actorId: user.id, action: 'escrow.declined', entity: 'match', entityId: row.id as string, ip: req.ip });
      throw new AppError(402, 'PAYMENT_DECLINED', 'The payment was declined');
    }
    const handoverCode = randomSixDigitCode();
    const deliveryCode = randomSixDigitCode();
    app.db.transaction(() => {
      app.db.run(
        `INSERT INTO escrows (id, match_id, payer_id, amount_minor, fee_minor, currency, status, provider, provider_ref, held_at)
         VALUES (?,?,?,?,?,?,'held',?,?,?)`,
        [randomUUID(), row.id as string, user.id, row.agreed_reward_minor as number, fees.platformFeeMinor + fees.protectionFeeMinor, row.currency as string, payments.name, providerRef, nowIso()],
      );
      setMatchStatus(
        app.db, row.id as string, 'funded', user.id,
        ', handover_code_hash = ?, delivery_code_hash = ?, handover_code_enc = ?, delivery_code_enc = ?, code_attempts = 0',
        [hmacHex(`${row.id}:handover_code_hash:${handoverCode}`), hmacHex(`${row.id}:delivery_code_hash:${deliveryCode}`), encryptField(handoverCode), encryptField(deliveryCode)],
      );
    });
    audit(app.db, { actorId: user.id, action: 'escrow.held', entity: 'match', entityId: row.id as string, meta: { amountMinor: fees.totalChargeMinor, provider: payments.name }, ip: req.ip });
    return { match: serializeMatch(app.db, app.db.get(`SELECT * FROM matches WHERE id = ?`, [row.id as string])!), codes: { handoverCode, deliveryCode } };
  });

  app.get('/matches/:id/codes', { preHandler: requireAuth, config: { rateLimit: { max: 30, timeWindow: '15 minutes' } } }, async (req) => {
    const user = assertUser(req);
    const { row, party } = loadMatch(app.db, (req.params as { id: string }).id, user);
    if (party !== 'sender') throw errors.forbidden('Only the sender can view the codes');
    assertStatus(row, ['funded', 'in_transit']);
    audit(app.db, { actorId: user.id, action: 'match.codes_viewed', entity: 'match', entityId: row.id as string, ip: req.ip });
    return { handoverCode: decryptField(row.handover_code_enc as string), deliveryCode: decryptField(row.delivery_code_enc as string) };
  });

  app.post('/matches/:id/handover', { preHandler: requireKyc, config: { rateLimit: { max: 20, timeWindow: '15 minutes' } } }, async (req) => {
    const user = assertUser(req);
    const { row, party } = loadMatch(app.db, (req.params as { id: string }).id, user);
    if (party !== 'traveler') throw errors.forbidden('Only the traveller confirms handover');
    assertStatus(row, ['funded']);
    const body = parse(handoverSchema, req.body);
    const owned = app.db.all(`SELECT ref FROM uploads WHERE user_id = ? AND ref IN (${body.photoRefs.map(() => '?').join(',')})`, [user.id, ...body.photoRefs]);
    if (owned.length !== new Set(body.photoRefs).size) throw errors.validation([{ path: 'photoRefs', message: 'Photo references must be your own uploads' }]);
    checkCode(app, req, row, 'handover_code_hash', body.code);
    app.db.transaction(() => {
      setMatchStatus(app.db, row.id as string, 'in_transit', user.id, ', inspection_notes = ?, inspection_photo_refs = ?', [body.inspectionNotes, JSON.stringify(body.photoRefs)]);
      app.db.run(`UPDATE requests SET status = 'in_transit', updated_at = ? WHERE id = ?`, [nowIso(), row.request_id as string]);
    });
    audit(app.db, { actorId: user.id, action: 'match.handover', entity: 'match', entityId: row.id as string, meta: { photos: body.photoRefs.length }, ip: req.ip });
    return { match: serializeMatch(app.db, app.db.get(`SELECT * FROM matches WHERE id = ?`, [row.id as string])!) };
  });

  app.post('/matches/:id/deliver', { preHandler: requireKyc, config: { rateLimit: { max: 20, timeWindow: '15 minutes' } } }, async (req) => {
    const user = assertUser(req);
    const { row, party } = loadMatch(app.db, (req.params as { id: string }).id, user);
    if (party !== 'traveler') throw errors.forbidden('Only the traveller confirms delivery');
    assertStatus(row, ['in_transit']);
    const body = parse(deliverSchema, req.body);
    checkCode(app, req, row, 'delivery_code_hash', body.code);
    // Escrow stays HELD here. It is released when the sender confirms completion or when the
    // dispute window lapses (completeMatch), so a dispute raised after delivery still has funds to act on.
    app.db.transaction(() => {
      setMatchStatus(app.db, row.id as string, 'delivered', user.id);
      app.db.run(`UPDATE requests SET status = 'delivered', updated_at = ? WHERE id = ?`, [nowIso(), row.request_id as string]);
    });
    audit(app.db, { actorId: user.id, action: 'match.delivered', entity: 'match', entityId: row.id as string, ip: req.ip });
    return { match: serializeMatch(app.db, app.db.get(`SELECT * FROM matches WHERE id = ?`, [row.id as string])!) };
  });

  app.post('/matches/:id/complete', { preHandler: requireAuth }, async (req) => {
    const user = assertUser(req);
    const { row, party } = loadMatch(app.db, (req.params as { id: string }).id, user);
    if (party !== 'sender') throw errors.forbidden('Only the sender confirms completion');
    assertStatus(row, ['delivered']);
    await completeMatch(app.db, payments, row.id as string, user.id, req.ip);
    return { match: serializeMatch(app.db, app.db.get(`SELECT * FROM matches WHERE id = ?`, [row.id as string])!) };
  });

  app.post('/matches/:id/dispute', { preHandler: requireAuth }, async (req, reply) => {
    const user = assertUser(req);
    const { row, party } = loadMatch(app.db, (req.params as { id: string }).id, user);
    if (party === 'admin') throw errors.forbidden();
    assertStatus(row, ['funded', 'in_transit', 'delivered']);
    const body = parse(disputeSchema, req.body);
    const dispute = openDispute(app.db, row.id as string, user.id, body.reason, body.details);
    audit(app.db, { actorId: user.id, action: 'dispute.open', entity: 'dispute', entityId: dispute.id as string, meta: { reason: body.reason }, ip: req.ip });
    return reply.code(201).send({ dispute: serializeDispute(dispute), match: serializeMatch(app.db, app.db.get(`SELECT * FROM matches WHERE id = ?`, [row.id as string])!) });
  });

  app.post('/matches/:id/review', { preHandler: requireAuth }, async (req, reply) => {
    const user = assertUser(req);
    const { row, party } = loadMatch(app.db, (req.params as { id: string }).id, user);
    if (party === 'admin') throw errors.forbidden();
    assertStatus(row, ['delivered', 'completed', 'resolved']);
    const body = parse(reviewSchema, req.body);
    const revieweeId = party === 'sender' ? (row.traveler_id as string) : (row.sender_id as string);
    const existing = app.db.get(`SELECT id FROM reviews WHERE match_id = ? AND reviewer_id = ?`, [row.id as string, user.id]);
    if (existing) throw errors.conflict('You already reviewed this match');
    const id = randomUUID();
    app.db.run(`INSERT INTO reviews (id, match_id, reviewer_id, reviewee_id, rating, comment, created_at) VALUES (?,?,?,?,?,?,?)`, [id, row.id as string, user.id, revieweeId, body.rating, redactPii(body.comment).text, nowIso()]);
    const review = app.db.get(`SELECT * FROM reviews WHERE id = ?`, [id])!;
    return reply.code(201).send({ review: { id: review.id, matchId: review.match_id, reviewerId: review.reviewer_id, revieweeId: review.reviewee_id, rating: review.rating, comment: review.comment, createdAt: review.created_at } });
  });

  const CHAT_STATUSES = ['accepted', 'funded', 'in_transit', 'delivered', 'disputed'];

  app.get('/matches/:id/messages', { preHandler: requireAuth }, async (req) => {
    const user = assertUser(req);
    const { row } = loadMatch(app.db, (req.params as { id: string }).id, user);
    const { after } = parse(z.object({ after: z.string().max(40).optional() }), req.query);
    const rows = after
      ? app.db.all(`SELECT * FROM messages WHERE match_id = ? AND created_at > ? ORDER BY created_at ASC LIMIT 200`, [row.id as string, after])
      : app.db.all(`SELECT * FROM messages WHERE match_id = ? ORDER BY created_at ASC LIMIT 200`, [row.id as string]);
    return { messages: rows.map((m) => ({ id: m.id, matchId: m.match_id, senderId: m.sender_id, body: m.body, redacted: m.redacted === 1, createdAt: m.created_at })) };
  });

  app.post('/matches/:id/messages', { preHandler: requireAuth, config: { rateLimit: { max: 120, timeWindow: '15 minutes' } } }, async (req, reply) => {
    const user = assertUser(req);
    const { row, party } = loadMatch(app.db, (req.params as { id: string }).id, user);
    if (party === 'admin') throw errors.forbidden();
    if (!CHAT_STATUSES.includes(row.status as string)) throw errors.invalidState('Chat opens once a match is accepted and closes when it completes');
    const body = parse(messageSchema, req.body);
    const { text, redacted } = redactPii(body.body);
    const id = randomUUID();
    const now = nowIso();
    app.db.run(`INSERT INTO messages (id, match_id, sender_id, body, redacted, created_at) VALUES (?,?,?,?,?,?)`, [id, row.id as string, user.id, text, redacted ? 1 : 0, now]);
    if (redacted) audit(app.db, { actorId: user.id, action: 'message.redacted', entity: 'match', entityId: row.id as string, ip: req.ip });
    return reply.code(201).send({ message: { id, matchId: row.id, senderId: user.id, body: text, redacted, createdAt: now } });
  });
}
