import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { api, cookieOf, createCtx, login, registerVerified, type TestCtx } from './helpers.js';

let ctx: TestCtx;
before(async () => { ctx = await createCtx(); });
after(async () => { await ctx.close(); });

test('register rejects weak passwords and duplicate emails', async () => {
  const weak = await api(ctx.app, null, 'POST', '/auth/register', { email: 'a@example.com', password: 'short', name: 'A B' });
  assert.equal(weak.status, 400);
  assert.equal(weak.body.error.code, 'VALIDATION_ERROR');
  const ok = await api(ctx.app, null, 'POST', '/auth/register', { email: 'a@example.com', password: 'Str0ng-Passw0rd!', name: 'A B' });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.user.emailVerified, false);
  assert.ok(ok.body.devVerificationToken);
  const dup = await api(ctx.app, null, 'POST', '/auth/register', { email: 'A@EXAMPLE.com', password: 'Str0ng-Passw0rd!', name: 'A B' });
  assert.equal(dup.status, 409);
});

test('login gives the same generic error for unknown email and wrong password', async () => {
  const unknown = await api(ctx.app, null, 'POST', '/auth/login', { email: 'nobody@example.com', password: 'whatever-123' });
  const wrong = await api(ctx.app, null, 'POST', '/auth/login', { email: 'a@example.com', password: 'wrong-password-1' });
  assert.equal(unknown.status, 401);
  assert.equal(wrong.status, 401);
  assert.deepEqual(unknown.body, wrong.body);
});

test('unverified email cannot post, verified email without KYC gets KYC_REQUIRED', async () => {
  const s = await login(ctx.app, 'a@example.com', 'Str0ng-Passw0rd!');
  const r1 = await api(ctx.app, s, 'POST', '/trips', {});
  assert.equal(r1.status, 403);
  assert.equal(r1.body.error.code, 'EMAIL_NOT_VERIFIED');
  const s2 = await registerVerified(ctx.app, 'b@example.com');
  const r2 = await api(ctx.app, s2, 'POST', '/trips', {});
  assert.equal(r2.status, 403);
  assert.equal(r2.body.error.code, 'KYC_REQUIRED');
});

test('refresh rotates the cookie and reuse of the old token revokes the family', async () => {
  const s = await registerVerified(ctx.app, 'c@example.com');
  const r1 = await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/refresh', headers: { cookie: s.cookie } });
  assert.equal(r1.statusCode, 200);
  const c2 = cookieOf(r1);
  assert.notEqual(c2, s.cookie);
  // replay the old one -> family revoked
  const replay = await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/refresh', headers: { cookie: s.cookie } });
  assert.equal(replay.statusCode, 401);
  const afterReplay = await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/refresh', headers: { cookie: c2 } });
  assert.equal(afterReplay.statusCode, 401, 'new token must also be dead after reuse detection');
});

test('access token is rejected when tampered and after logout the refresh is dead', async () => {
  const s = await registerVerified(ctx.app, 'd@example.com');
  const bad = await ctx.app.inject({ method: 'GET', url: '/api/v1/me', headers: { authorization: `Bearer ${s.token}x` } });
  assert.equal(bad.statusCode, 401);
  const me = await api(ctx.app, s, 'GET', '/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.user.email, 'd@example.com');
  const out = await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: { cookie: s.cookie } });
  assert.equal(out.statusCode, 200);
  const dead = await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/refresh', headers: { cookie: s.cookie } });
  assert.equal(dead.statusCode, 401);
});

test('sessions list marks the current session and revocation works', async () => {
  const s = await registerVerified(ctx.app, 'g@example.com');
  const list = await api(ctx.app, s, 'GET', '/me/sessions');
  assert.equal(list.status, 200);
  assert.equal(list.body.sessions.length, 1);
  assert.equal(list.body.sessions[0].current, true);
  const del = await api(ctx.app, s, 'DELETE', `/me/sessions/${list.body.sessions[0].id}`);
  assert.equal(del.status, 200);
  const dead = await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/refresh', headers: { cookie: s.cookie } });
  assert.equal(dead.statusCode, 401);
});

test('phone is stored encrypted and only returned masked', async () => {
  const s = await registerVerified(ctx.app, 'e@example.com');
  const r = await api(ctx.app, s, 'PATCH', '/me', { phone: '+44 7700 900123' });
  assert.equal(r.status, 200);
  assert.equal(r.body.user.phoneMasked, '••• ••• 0123');
  assert.equal(JSON.stringify(r.body).includes('7700'), false);
  const row = ctx.app.db.get(`SELECT phone_enc FROM users WHERE email = 'e@example.com'`)!;
  assert.ok(String(row.phone_enc).startsWith('v1.'));
  assert.equal(String(row.phone_enc).includes('7700'), false);
});

test('auth routes are rate limited per IP', async () => {
  const { buildApp } = await import('../src/app.js');
  const { Db } = await import('../src/db.js');
  const app = await buildApp({ db: new Db(':memory:'), logger: false, rateLimits: true });
  let last = 0;
  for (let i = 0; i < 11; i++) {
    const r = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'x@example.com', password: 'whatever-123' } });
    last = r.statusCode;
    if (i < 10) assert.equal(last, 401);
  }
  assert.equal(last, 429);
  await app.close();
});

test('admin routes are forbidden for normal users and security headers are present', async () => {
  const s = await registerVerified(ctx.app, 'f@example.com');
  const r = await api(ctx.app, s, 'GET', '/admin/users');
  assert.equal(r.status, 403);
  const h = await ctx.app.inject({ method: 'GET', url: '/api/v1/health' });
  assert.equal(h.headers['x-content-type-options'], 'nosniff');
  assert.ok(String(h.headers['content-security-policy']).includes("default-src 'none'"));
});
