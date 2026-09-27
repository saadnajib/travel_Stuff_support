import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { nowIso } from '../db.js';
import {
  CATEGORY_KEYS,
  FEES,
  PRESCRIPTION_ATTESTATION,
  REQUIRED_ATTESTATIONS,
  categoryRule,
  findProhibited,
} from '../domain/categories.js';
import { audit } from '../lib/audit.js';
import { encryptField } from '../lib/crypto.js';
import { errors } from '../lib/errors.js';
import { serializeRequest } from '../lib/serialize.js';
import { parse } from '../lib/validate.js';
import { assertUser, requireAuth, requireKyc } from '../plugins/auth.js';

const iso2 = z.string().regex(/^[A-Z]{2}$/, 'ISO-3166 alpha-2 country code');
const city = z.string().trim().min(2).max(80);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');

const itemSchema = z.object({
  name: z.string().trim().min(2).max(120),
  qty: z.number().int().min(1).max(50),
  valueMinor: z.number().int().min(0).max(1_000_000),
});

const createSchema = z
  .object({
    originCountry: iso2,
    originCity: city,
    destCountry: iso2,
    destCity: city,
    category: z.enum(CATEGORY_KEYS),
    title: z.string().trim().min(5).max(120),
    description: z.string().trim().min(10).max(2000),
    items: z.array(itemSchema).max(20),
    weightKg: z.number().min(0).max(FEES.maxTripCapacityKg),
    rewardMinor: z.number().int().min(FEES.minRewardMinor).max(FEES.maxRewardMinor),
    currency: z.string().regex(/^[A-Z]{3}$/).default('USD'),
    neededByDate: isoDate,
    recipientName: z.string().trim().min(2).max(120),
    recipientPhone: z.string().trim().regex(/^\+?[0-9 ()-]{7,20}$/, 'Phone must be digits with optional +, spaces, dashes'),
    attestations: z.array(z.string().max(60)).max(10),
  })
  .refine((r) => r.originCountry !== r.destCountry, { message: 'Origin and destination country must differ', path: ['destCountry'] })
  .refine((r) => r.neededByDate >= nowIso().slice(0, 10), { message: 'Needed-by date must be today or later', path: ['neededByDate'] });

const patchSchema = z.object({
  title: z.string().trim().min(5).max(120).optional(),
  description: z.string().trim().min(10).max(2000).optional(),
  rewardMinor: z.number().int().min(FEES.minRewardMinor).max(FEES.maxRewardMinor).optional(),
  neededByDate: isoDate.optional(),
  recipientName: z.string().trim().min(2).max(120).optional(),
});

const searchSchema = z.object({
  from: iso2.optional(),
  to: iso2.optional(),
  category: z.enum(CATEGORY_KEYS).optional(),
  dateTo: isoDate.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

export function validateBusinessRules(body: z.infer<typeof createSchema>): { declaredValueMinor: number } {
  const rule = categoryRule(body.category);
  const matched = findProhibited([body.title, body.description, ...body.items.map((i) => i.name)]);
  if (matched.length) throw errors.prohibited(matched);

  const declaredValueMinor = body.items.reduce((sum, i) => sum + i.qty * i.valueMinor, 0);
  const issues: { path: string; message: string }[] = [];

  if (body.category === 'companion_assist') {
    if (body.items.length > 0 || body.weightKg > 0) issues.push({ path: 'items', message: 'Companion assistance cannot include goods' });
  } else {
    if (body.items.length === 0) issues.push({ path: 'items', message: 'Declare at least one item' });
    if (body.weightKg <= 0) issues.push({ path: 'weightKg', message: 'Weight must be greater than 0' });
    if (body.weightKg > rule.maxWeightKg) issues.push({ path: 'weightKg', message: `Maximum for ${rule.label} is ${rule.maxWeightKg} kg` });
    if (declaredValueMinor > rule.maxValueMinor) issues.push({ path: 'items', message: `Maximum declared value for ${rule.label} is ${rule.maxValueMinor / 100} ${body.currency}` });
  }

  const provided = new Set(body.attestations);
  for (const key of REQUIRED_ATTESTATIONS) {
    if (!provided.has(key)) issues.push({ path: 'attestations', message: `Missing attestation: ${key}` });
  }
  if (rule.requiresPrescription && !provided.has(PRESCRIPTION_ATTESTATION)) {
    issues.push({ path: 'attestations', message: `Missing attestation: ${PRESCRIPTION_ATTESTATION}` });
  }
  if (issues.length) throw errors.validation(issues);
  return { declaredValueMinor };
}

export async function requestRoutes(app: FastifyInstance): Promise<void> {
  app.post('/requests', { preHandler: requireKyc }, async (req, reply) => {
    const user = assertUser(req);
    const body = parse(createSchema, req.body);
    const { declaredValueMinor } = validateBusinessRules(body);
    const id = randomUUID();
    const now = nowIso();
    app.db.run(
      `INSERT INTO requests (id, sender_id, origin_country, origin_city, dest_country, dest_city, category, title, description, items, weight_kg,
         declared_value_minor, reward_minor, currency, needed_by_date, recipient_name, recipient_phone_enc, attestations, status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'open',?,?)`,
      [
        id, user.id, body.originCountry, body.originCity, body.destCountry, body.destCity, body.category, body.title, body.description,
        JSON.stringify(body.items), body.weightKg, declaredValueMinor, body.rewardMinor, body.currency, body.neededByDate,
        body.recipientName, encryptField(body.recipientPhone), JSON.stringify(body.attestations), now, now,
      ],
    );
    audit(app.db, { actorId: user.id, action: 'request.create', entity: 'request', entityId: id, meta: { category: body.category, declaredValueMinor }, ip: req.ip });
    return reply.code(201).send({ request: serializeRequest(app.db, app.db.get(`SELECT * FROM requests WHERE id = ?`, [id])!, user) });
  });

  app.get('/requests', async (req) => {
    const q = parse(searchSchema, req.query);
    const where: string[] = [`r.status = 'open'`, `r.needed_by_date >= ?`, `u.suspended = 0`];
    const params: (string | number)[] = [nowIso().slice(0, 10)];
    if (q.from) { where.push('r.origin_country = ?'); params.push(q.from); }
    if (q.to) { where.push('r.dest_country = ?'); params.push(q.to); }
    if (q.category) { where.push('r.category = ?'); params.push(q.category); }
    if (q.dateTo) { where.push('r.needed_by_date <= ?'); params.push(q.dateTo); }
    const sql = `FROM requests r JOIN users u ON u.id = r.sender_id WHERE ${where.join(' AND ')}`;
    const total = app.db.get<{ c: number }>(`SELECT COUNT(*) c ${sql}`, params)!.c;
    const rows = app.db.all(`SELECT r.* ${sql} ORDER BY r.needed_by_date ASC LIMIT ? OFFSET ?`, [...params, q.pageSize, (q.page - 1) * q.pageSize]);
    return { requests: rows.map((r) => serializeRequest(app.db, r, req.user)), page: q.page, pageSize: q.pageSize, total };
  });

  app.get('/requests/mine', { preHandler: requireAuth }, async (req) => {
    const user = assertUser(req);
    const rows = app.db.all(`SELECT * FROM requests WHERE sender_id = ? ORDER BY created_at DESC`, [user.id]);
    return { requests: rows.map((r) => serializeRequest(app.db, r, user)) };
  });

  app.get('/requests/:id', async (req) => {
    const { id } = req.params as { id: string };
    const row = app.db.get(`SELECT * FROM requests WHERE id = ?`, [id]);
    if (!row) throw errors.notFound('Request');
    return { request: serializeRequest(app.db, row, req.user) };
  });

  app.patch('/requests/:id', { preHandler: requireKyc }, async (req) => {
    const user = assertUser(req);
    const { id } = req.params as { id: string };
    const row = app.db.get(`SELECT * FROM requests WHERE id = ?`, [id]);
    if (!row) throw errors.notFound('Request');
    if (row.sender_id !== user.id) throw errors.forbidden();
    if (row.status !== 'open') throw errors.invalidState('Only open requests can be edited');
    const body = parse(patchSchema, req.body);
    if (body.title || body.description) {
      const matched = findProhibited([body.title ?? (row.title as string), body.description ?? (row.description as string)]);
      if (matched.length) throw errors.prohibited(matched);
    }
    const sets: string[] = [];
    const params: (string | number)[] = [];
    if (body.title !== undefined) { sets.push('title = ?'); params.push(body.title); }
    if (body.description !== undefined) { sets.push('description = ?'); params.push(body.description); }
    if (body.rewardMinor !== undefined) { sets.push('reward_minor = ?'); params.push(body.rewardMinor); }
    if (body.neededByDate !== undefined) { sets.push('needed_by_date = ?'); params.push(body.neededByDate); }
    if (body.recipientName !== undefined) { sets.push('recipient_name = ?'); params.push(body.recipientName); }
    if (sets.length) {
      sets.push('updated_at = ?');
      params.push(nowIso(), id);
      app.db.run(`UPDATE requests SET ${sets.join(', ')} WHERE id = ?`, params);
    }
    return { request: serializeRequest(app.db, app.db.get(`SELECT * FROM requests WHERE id = ?`, [id])!, user) };
  });

  app.post('/requests/:id/cancel', { preHandler: requireAuth }, async (req) => {
    const user = assertUser(req);
    const { id } = req.params as { id: string };
    const row = app.db.get(`SELECT * FROM requests WHERE id = ?`, [id]);
    if (!row) throw errors.notFound('Request');
    if (row.sender_id !== user.id) throw errors.forbidden();
    const active = app.db.get(`SELECT id FROM matches WHERE request_id = ? AND status IN ('funded','in_transit','delivered','disputed')`, [id]);
    if (active) throw errors.invalidState('This request has a funded delivery. Resolve it before cancelling.');
    app.db.transaction(() => {
      app.db.run(`UPDATE requests SET status = 'cancelled', updated_at = ? WHERE id = ?`, [nowIso(), id]);
      app.db.run(`UPDATE matches SET status = 'cancelled', updated_at = ? WHERE request_id = ? AND status IN ('proposed','accepted')`, [nowIso(), id]);
    });
    audit(app.db, { actorId: user.id, action: 'request.cancel', entity: 'request', entityId: id, ip: req.ip });
    return { request: serializeRequest(app.db, app.db.get(`SELECT * FROM requests WHERE id = ?`, [id])!, user) };
  });
}
