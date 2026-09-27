import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { config } from '../config.js';
import { nowIso } from '../db.js';
import { audit } from '../lib/audit.js';
import { encryptField, hashPassword, hmacHex, last4, randomToken, signJwt, verifyPassword } from '../lib/crypto.js';
import { AppError, errors } from '../lib/errors.js';
import { serializeUser, userRatings } from '../lib/serialize.js';
import { parse } from '../lib/validate.js';
import { assertUser, requireAuth } from '../plugins/auth.js';

const REFRESH_COOKIE = 'cl_refresh';
const MAX_FAILED_LOGINS = 8;
const LOCK_MINUTES = 15;

const emailSchema = z.string().trim().toLowerCase().email().max(254);
const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128)
  .refine((p) => !/^(.)\1+$/.test(p), 'Password is too weak');

const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z.string().trim().min(2).max(80),
});

const loginSchema = z.object({ email: emailSchema, password: z.string().min(1).max(128) });
const verifySchema = z.object({ token: z.string().min(10).max(200) });
const patchMeSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9 ()-]{7,20}$/, 'Phone must be digits with optional +, spaces, dashes')
    .optional(),
});

function issueEmailToken(app: FastifyInstance, userId: string): string {
  const token = randomToken(32);
  app.db.run(`INSERT INTO email_tokens (token_hash, user_id, purpose, expires_at, used, created_at) VALUES (?,?,?,?,0,?)`, [
    hmacHex(token),
    userId,
    'verify_email',
    new Date(Date.now() + config.emailTokenTtlSec * 1000).toISOString(),
    nowIso(),
  ]);
  return token;
}

function setRefreshCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.cookieSecure,
    path: '/api/v1',
    maxAge: config.refreshTokenTtlSec,
  });
}

function clearRefreshCookie(reply: FastifyReply): void {
  reply.clearCookie(REFRESH_COOKIE, { path: '/api/v1' });
}

function createRefreshToken(app: FastifyInstance, req: FastifyRequest, userId: string, familyId?: string): string {
  const token = randomToken(48);
  const id = randomUUID();
  const now = nowIso();
  app.db.run(
    `INSERT INTO refresh_tokens (id, user_id, family_id, token_hash, expires_at, revoked, replaced_by, ip, user_agent, created_at, last_used_at)
     VALUES (?,?,?,?,?,0,NULL,?,?,?,?)`,
    [
      id,
      userId,
      familyId ?? id,
      hmacHex(token),
      new Date(Date.now() + config.refreshTokenTtlSec * 1000).toISOString(),
      req.ip,
      (req.headers['user-agent'] ?? '').slice(0, 200),
      now,
      now,
    ],
  );
  return token;
}

function fullUser(app: FastifyInstance, userId: string) {
  const row = app.db.get(`SELECT * FROM users WHERE id = ?`, [userId]);
  if (!row) throw errors.notFound('User');
  return serializeUser(row, userRatings(app.db, userId));
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  const strictLimit = { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } };

  app.post('/auth/register', strictLimit, async (req, reply) => {
    const body = parse(registerSchema, req.body);
    const existing = app.db.get(`SELECT id FROM users WHERE email = ?`, [body.email]);
    if (existing) throw errors.conflict('An account with this email already exists');
    const id = randomUUID();
    const now = nowIso();
    app.db.run(
      `INSERT INTO users (id, email, password_hash, name, role, email_verified, kyc_status, created_at, updated_at)
       VALUES (?,?,?,?, 'user', 0, 'none', ?, ?)`,
      [id, body.email, await hashPassword(body.password), body.name, now, now],
    );
    const token = issueEmailToken(app, id);
    audit(app.db, { actorId: id, action: 'user.register', entity: 'user', entityId: id, ip: req.ip });
    // In production this token is emailed. In dev we return it so the flow works without SMTP.
    return reply.code(201).send({ user: fullUser(app, id), ...(config.devReturnTokens ? { devVerificationToken: token } : {}) });
  });

  app.post('/auth/verify-email', strictLimit, async (req) => {
    const { token } = parse(verifySchema, req.body);
    const row = app.db.get(`SELECT * FROM email_tokens WHERE token_hash = ? AND purpose = 'verify_email'`, [hmacHex(token)]);
    if (!row || row.used === 1 || (row.expires_at as string) < nowIso()) {
      throw new AppError(400, 'INVALID_TOKEN', 'Invalid or expired verification token');
    }
    app.db.transaction(() => {
      app.db.run(`UPDATE email_tokens SET used = 1 WHERE token_hash = ?`, [row.token_hash as string]);
      app.db.run(`UPDATE users SET email_verified = 1, updated_at = ? WHERE id = ?`, [nowIso(), row.user_id as string]);
    });
    audit(app.db, { actorId: row.user_id as string, action: 'user.email_verified', entity: 'user', entityId: row.user_id as string, ip: req.ip });
    return { ok: true };
  });

  app.post('/auth/resend-verification', { ...strictLimit, preHandler: requireAuth }, async (req) => {
    const user = assertUser(req);
    if (user.emailVerified) throw errors.conflict('Email already verified');
    const token = issueEmailToken(app, user.id);
    return { ok: true, ...(config.devReturnTokens ? { devVerificationToken: token } : {}) };
  });

  app.post('/auth/login', strictLimit, async (req, reply) => {
    const body = parse(loginSchema, req.body);
    const row = app.db.get(`SELECT * FROM users WHERE email = ?`, [body.email]);
    // Always run the hash check to keep timing similar for unknown emails.
    const dummyHash = 'scrypt$16384$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
    const ok = await verifyPassword(body.password, (row?.password_hash as string) ?? dummyHash);
    if (!row) throw errors.invalidCredentials();
    if (row.locked_until && (row.locked_until as string) > nowIso()) {
      throw new AppError(429, 'RATE_LIMITED', 'Too many failed attempts. Try again later.');
    }
    if (!ok) {
      const failed = (row.failed_logins as number) + 1;
      const lock = failed >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString() : null;
      app.db.run(`UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?`, [lock ? 0 : failed, lock, row.id as string]);
      audit(app.db, { actorId: null, action: 'auth.login_failed', entity: 'user', entityId: row.id as string, ip: req.ip });
      throw errors.invalidCredentials();
    }
    if (row.suspended === 1) throw errors.suspended();
    app.db.run(`UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?`, [row.id as string]);
    const refresh = createRefreshToken(app, req, row.id as string);
    setRefreshCookie(reply, refresh);
    audit(app.db, { actorId: row.id as string, action: 'auth.login', entity: 'user', entityId: row.id as string, ip: req.ip });
    return {
      accessToken: signJwt({ sub: row.id as string, role: row.role as 'user' | 'admin' }, config.accessTokenTtlSec),
      user: fullUser(app, row.id as string),
    };
  });

  app.post('/auth/refresh', { config: { rateLimit: { max: 60, timeWindow: '15 minutes' } } }, async (req, reply) => {
    const raw = req.cookies[REFRESH_COOKIE];
    if (!raw) throw errors.unauthorized('No session');
    const row = app.db.get(`SELECT * FROM refresh_tokens WHERE token_hash = ?`, [hmacHex(raw)]);
    if (!row) {
      clearRefreshCookie(reply);
      throw errors.unauthorized('Invalid session');
    }
    if (row.revoked === 1 || (row.expires_at as string) < nowIso()) {
      // Reuse of a rotated token => the family is compromised. Revoke all of it.
      app.db.run(`UPDATE refresh_tokens SET revoked = 1 WHERE family_id = ?`, [row.family_id as string]);
      audit(app.db, { actorId: row.user_id as string, action: 'auth.refresh_reuse_detected', entity: 'refresh_family', entityId: row.family_id as string, ip: req.ip });
      clearRefreshCookie(reply);
      throw errors.unauthorized('Session revoked');
    }
    const user = app.db.get(`SELECT * FROM users WHERE id = ?`, [row.user_id as string]);
    if (!user || user.suspended === 1) {
      clearRefreshCookie(reply);
      throw errors.unauthorized('Session revoked');
    }
    const next = app.db.transaction(() => {
      const t = createRefreshToken(app, req, row.user_id as string, row.family_id as string);
      app.db.run(`UPDATE refresh_tokens SET revoked = 1, replaced_by = ?, last_used_at = ? WHERE id = ?`, [hmacHex(t), nowIso(), row.id as string]);
      return t;
    });
    setRefreshCookie(reply, next);
    return {
      accessToken: signJwt({ sub: user.id as string, role: user.role as 'user' | 'admin' }, config.accessTokenTtlSec),
      user: fullUser(app, user.id as string),
    };
  });

  app.post('/auth/logout', async (req, reply) => {
    const raw = req.cookies[REFRESH_COOKIE];
    if (raw) {
      const row = app.db.get(`SELECT family_id FROM refresh_tokens WHERE token_hash = ?`, [hmacHex(raw)]);
      if (row) app.db.run(`UPDATE refresh_tokens SET revoked = 1 WHERE family_id = ?`, [row.family_id as string]);
    }
    clearRefreshCookie(reply);
    return { ok: true };
  });

  app.get('/me', { preHandler: requireAuth }, async (req) => ({ user: fullUser(app, assertUser(req).id) }));

  app.patch('/me', { preHandler: requireAuth }, async (req) => {
    const user = assertUser(req);
    const body = parse(patchMeSchema, req.body);
    if (body.name !== undefined) app.db.run(`UPDATE users SET name = ?, updated_at = ? WHERE id = ?`, [body.name, nowIso(), user.id]);
    if (body.phone !== undefined) {
      app.db.run(`UPDATE users SET phone_enc = ?, phone_last4 = ?, updated_at = ? WHERE id = ?`, [
        encryptField(body.phone),
        last4(body.phone),
        nowIso(),
        user.id,
      ]);
    }
    audit(app.db, { actorId: user.id, action: 'user.update_profile', entity: 'user', entityId: user.id, meta: { fields: Object.keys(body) }, ip: req.ip });
    return { user: fullUser(app, user.id) };
  });

  app.get('/me/sessions', { preHandler: requireAuth }, async (req) => {
    const user = assertUser(req);
    const current = req.cookies[REFRESH_COOKIE] ? hmacHex(req.cookies[REFRESH_COOKIE]!) : null;
    const rows = app.db.all(
      `SELECT id, family_id, token_hash, created_at, last_used_at, ip, user_agent FROM refresh_tokens
       WHERE user_id = ? AND revoked = 0 AND expires_at > ? ORDER BY last_used_at DESC`,
      [user.id, nowIso()],
    );
    return {
      sessions: rows.map((r) => ({
        id: r.family_id,
        createdAt: r.created_at,
        lastUsedAt: r.last_used_at,
        ip: r.ip,
        userAgent: r.user_agent,
        current: current !== null && r.token_hash === current,
      })),
    };
  });

  app.delete('/me/sessions/:id', { preHandler: requireAuth }, async (req) => {
    const user = assertUser(req);
    const { id } = req.params as { id: string };
    const res = app.db.run(`UPDATE refresh_tokens SET revoked = 1 WHERE family_id = ? AND user_id = ?`, [id, user.id]);
    if (res.changes === 0) throw errors.notFound('Session');
    audit(app.db, { actorId: user.id, action: 'auth.session_revoked', entity: 'refresh_family', entityId: id, ip: req.ip });
    return { ok: true };
  });
}
