import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { nowIso } from '../db.js';
import { CATEGORY_KEYS, FEES } from '../domain/categories.js';
import { audit } from '../lib/audit.js';
import { hmacHex } from '../lib/crypto.js';
import { errors } from '../lib/errors.js';
import { serializeTrip } from '../lib/serialize.js';
import { parse } from '../lib/validate.js';
import { assertUser, requireAuth, requireKyc } from '../plugins/auth.js';

const iso2 = z.string().regex(/^[A-Z]{2}$/, 'ISO-3166 alpha-2 country code');
const city = z.string().trim().min(2).max(80);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');

const createSchema = z
  .object({
    originCountry: iso2,
    originCity: city,
    destCountry: iso2,
    destCity: city,
    departDate: isoDate,
    arriveDate: isoDate,
    capacityKg: z.number().min(0.1).max(FEES.maxTripCapacityKg),
    allowedCategories: z.array(z.enum(CATEGORY_KEYS)).min(1).max(CATEGORY_KEYS.length),
    bookingRef: z.string().trim().max(20).optional(),
    notes: z.string().trim().max(1000).optional(),
  })
  .refine((t) => t.originCountry !== t.destCountry, { message: 'Origin and destination country must differ', path: ['destCountry'] })
  .refine((t) => t.arriveDate >= t.departDate, { message: 'Arrival must not be before departure', path: ['arriveDate'] })
  .refine((t) => t.departDate >= nowIso().slice(0, 10), { message: 'Departure must be today or later', path: ['departDate'] });

const patchSchema = z.object({
  originCity: city.optional(),
  destCity: city.optional(),
  capacityKg: z.number().min(0.1).max(FEES.maxTripCapacityKg).optional(),
  allowedCategories: z.array(z.enum(CATEGORY_KEYS)).min(1).optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});

const verifySchema = z.object({
  bookingRef: z.string().trim().min(5).max(20),
  airline: z.string().trim().min(2).max(60),
});

const searchSchema = z.object({
  from: iso2.optional(),
  to: iso2.optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
  category: z.enum(CATEGORY_KEYS).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

export async function tripRoutes(app: FastifyInstance): Promise<void> {
  app.post('/trips', { preHandler: requireKyc }, async (req, reply) => {
    const user = assertUser(req);
    const body = parse(createSchema, req.body);
    const id = randomUUID();
    const now = nowIso();
    app.db.run(
      `INSERT INTO trips (id, traveler_id, origin_country, origin_city, dest_country, dest_city, depart_date, arrive_date, capacity_kg, allowed_categories, booking_ref_hash, verified, status, notes, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,0,'published',?,?,?)`,
      [
        id, user.id, body.originCountry, body.originCity, body.destCountry, body.destCity, body.departDate, body.arriveDate,
        body.capacityKg, JSON.stringify(body.allowedCategories), body.bookingRef ? hmacHex(body.bookingRef.toUpperCase()) : null,
        body.notes ?? null, now, now,
      ],
    );
    audit(app.db, { actorId: user.id, action: 'trip.create', entity: 'trip', entityId: id, ip: req.ip });
    return reply.code(201).send({ trip: serializeTrip(app.db, app.db.get(`SELECT * FROM trips WHERE id = ?`, [id])!) });
  });

  app.get('/trips', async (req) => {
    const q = parse(searchSchema, req.query);
    const where: string[] = [`t.status = 'published'`, `t.verified = 1`, `t.depart_date >= ?`, `u.suspended = 0`, `u.kyc_status = 'verified'`];
    const params: (string | number)[] = [nowIso().slice(0, 10)];
    if (q.from) { where.push('t.origin_country = ?'); params.push(q.from); }
    if (q.to) { where.push('t.dest_country = ?'); params.push(q.to); }
    if (q.dateFrom) { where.push('t.depart_date >= ?'); params.push(q.dateFrom); }
    if (q.dateTo) { where.push('t.depart_date <= ?'); params.push(q.dateTo); }
    if (q.category) { where.push(`t.allowed_categories LIKE ?`); params.push(`%"${q.category}"%`); }
    const sql = `FROM trips t JOIN users u ON u.id = t.traveler_id WHERE ${where.join(' AND ')}`;
    const total = app.db.get<{ c: number }>(`SELECT COUNT(*) c ${sql}`, params)!.c;
    const rows = app.db.all(`SELECT t.* ${sql} ORDER BY t.depart_date ASC LIMIT ? OFFSET ?`, [...params, q.pageSize, (q.page - 1) * q.pageSize]);
    return { trips: rows.map((r) => serializeTrip(app.db, r)), page: q.page, pageSize: q.pageSize, total };
  });

  app.get('/trips/mine', { preHandler: requireAuth }, async (req) => {
    const user = assertUser(req);
    const rows = app.db.all(`SELECT * FROM trips WHERE traveler_id = ? ORDER BY depart_date DESC`, [user.id]);
    return { trips: rows.map((r) => serializeTrip(app.db, r)) };
  });

  app.get('/trips/:id', async (req) => {
    const { id } = req.params as { id: string };
    const row = app.db.get(`SELECT * FROM trips WHERE id = ?`, [id]);
    if (!row) throw errors.notFound('Trip');
    return { trip: serializeTrip(app.db, row) };
  });

  app.patch('/trips/:id', { preHandler: requireKyc }, async (req) => {
    const user = assertUser(req);
    const { id } = req.params as { id: string };
    const row = app.db.get(`SELECT * FROM trips WHERE id = ?`, [id]);
    if (!row) throw errors.notFound('Trip');
    if (row.traveler_id !== user.id) throw errors.forbidden();
    if (row.status !== 'published') throw errors.invalidState('Only published trips can be edited');
    const body = parse(patchSchema, req.body);
    const sets: string[] = [];
    const params: (string | number | null)[] = [];
    if (body.originCity !== undefined) { sets.push('origin_city = ?'); params.push(body.originCity); }
    if (body.destCity !== undefined) { sets.push('dest_city = ?'); params.push(body.destCity); }
    if (body.capacityKg !== undefined) { sets.push('capacity_kg = ?'); params.push(body.capacityKg); }
    if (body.allowedCategories !== undefined) { sets.push('allowed_categories = ?'); params.push(JSON.stringify(body.allowedCategories)); }
    if (body.notes !== undefined) { sets.push('notes = ?'); params.push(body.notes); }
    if (sets.length) {
      sets.push('updated_at = ?');
      params.push(nowIso(), id);
      app.db.run(`UPDATE trips SET ${sets.join(', ')} WHERE id = ?`, params);
    }
    return { trip: serializeTrip(app.db, app.db.get(`SELECT * FROM trips WHERE id = ?`, [id])!) };
  });

  /** Mock flight verification. Production: airline PNR lookup / boarding-pass scan via a vendor. */
  app.post('/trips/:id/verify', { preHandler: requireKyc, config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (req) => {
    const user = assertUser(req);
    const { id } = req.params as { id: string };
    const row = app.db.get(`SELECT * FROM trips WHERE id = ?`, [id]);
    if (!row) throw errors.notFound('Trip');
    if (row.traveler_id !== user.id) throw errors.forbidden();
    const body = parse(verifySchema, req.body);
    const ref = body.bookingRef.toUpperCase();
    const looksValid = /^[A-Z0-9]{6}$/.test(ref);
    app.db.run(`UPDATE trips SET booking_ref_hash = ?, verified = ?, updated_at = ? WHERE id = ?`, [hmacHex(ref), looksValid ? 1 : 0, nowIso(), id]);
    audit(app.db, { actorId: user.id, action: looksValid ? 'trip.verified' : 'trip.verify_failed', entity: 'trip', entityId: id, meta: { airline: body.airline }, ip: req.ip });
    if (!looksValid) throw errors.validation([{ path: 'bookingRef', message: 'Booking reference could not be verified' }]);
    return { trip: serializeTrip(app.db, app.db.get(`SELECT * FROM trips WHERE id = ?`, [id])!) };
  });

  app.post('/trips/:id/cancel', { preHandler: requireAuth }, async (req) => {
    const user = assertUser(req);
    const { id } = req.params as { id: string };
    const row = app.db.get(`SELECT * FROM trips WHERE id = ?`, [id]);
    if (!row) throw errors.notFound('Trip');
    if (row.traveler_id !== user.id) throw errors.forbidden();
    const active = app.db.get(
      `SELECT id FROM matches WHERE trip_id = ? AND status IN ('funded','in_transit','delivered','disputed')`,
      [id],
    );
    if (active) throw errors.invalidState('This trip has a funded delivery. Resolve it before cancelling.');
    app.db.transaction(() => {
      app.db.run(`UPDATE trips SET status = 'cancelled', updated_at = ? WHERE id = ?`, [nowIso(), id]);
      app.db.run(`UPDATE matches SET status = 'cancelled', updated_at = ? WHERE trip_id = ? AND status IN ('proposed','accepted')`, [nowIso(), id]);
      app.db.run(
        `UPDATE requests SET status = 'open', updated_at = ? WHERE status = 'matched' AND id IN (SELECT request_id FROM matches WHERE trip_id = ? AND status = 'cancelled')`,
        [nowIso(), id],
      );
    });
    audit(app.db, { actorId: user.id, action: 'trip.cancel', entity: 'trip', entityId: id, ip: req.ip });
    return { trip: serializeTrip(app.db, app.db.get(`SELECT * FROM trips WHERE id = ?`, [id])!) };
  });
}
