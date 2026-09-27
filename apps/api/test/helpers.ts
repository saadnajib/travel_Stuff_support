process.env.NODE_ENV = 'test';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { buildApp } from '../src/app.js';
import { Db } from '../src/db.js';
import { seed, type SeedResult } from '../src/seed.js';

export interface TestCtx {
  app: FastifyInstance;
  seeded: SeedResult;
  close: () => Promise<void>;
}

export async function createCtx(): Promise<TestCtx> {
  const db = new Db(':memory:');
  const app = await buildApp({ db, logger: false });
  const { migrate } = await import('../src/db.js');
  migrate(db);
  const seeded = await seed(db);
  return { app, seeded, close: () => app.close() };
}

export interface Session {
  token: string;
  cookie: string;
  user: { id: string; email: string; kycStatus: string; role: string };
}

export function cookieOf(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers['set-cookie'];
  const arr = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
  const rc = arr.find((c) => c.startsWith('cl_refresh='));
  if (!rc) throw new Error('no refresh cookie in response');
  return rc.split(';')[0];
}

export async function login(app: FastifyInstance, email: string, password: string): Promise<Session> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
  if (res.statusCode !== 200) throw new Error(`login failed ${res.statusCode} ${res.body}`);
  const body = res.json();
  return { token: body.accessToken, cookie: cookieOf(res), user: body.user };
}

export async function registerVerified(app: FastifyInstance, email: string, name = 'Test User', password = 'Str0ng-Passw0rd!'): Promise<Session> {
  const reg = await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { email, password, name } });
  if (reg.statusCode !== 201) throw new Error(`register failed ${reg.statusCode} ${reg.body}`);
  const token = reg.json().devVerificationToken as string;
  const ver = await app.inject({ method: 'POST', url: '/api/v1/auth/verify-email', payload: { token } });
  if (ver.statusCode !== 200) throw new Error(`verify failed ${ver.body}`);
  return login(app, email, password);
}

export function authed(s: Session, opts: InjectOptions): InjectOptions {
  return { ...opts, headers: { ...(opts.headers ?? {}), authorization: `Bearer ${s.token}`, cookie: s.cookie } };
}

export async function api(app: FastifyInstance, s: Session | null, method: InjectOptions['method'], url: string, payload?: unknown) {
  const opts: InjectOptions = { method, url: `/api/v1${url}`, ...(payload !== undefined ? { payload: payload as object } : {}) };
  const res = await app.inject(s ? authed(s, opts) : opts);
  let json: any = null;
  try { json = res.json(); } catch { /* non-json */ }
  return { status: res.statusCode, body: json, res };
}

export function plusDays(n: number): string {
  return new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
}

export async function upload(app: FastifyInstance, s: Session): Promise<string> {
  const r = await api(app, s, 'POST', '/uploads', { filename: 'photo.jpg', contentType: 'image/jpeg', sizeBytes: 1000, sha256: 'b'.repeat(64) });
  if (r.status !== 201) throw new Error(`upload failed ${r.res.body}`);
  return r.body.ref;
}

/** Complete KYC for a user via the admin queue. */
export async function verifyKyc(app: FastifyInstance, s: Session, admin: Session): Promise<Session> {
  const ref = await upload(app, s);
  const sub = await api(app, s, 'POST', '/kyc/submit', { docType: 'passport', docNumber: `PX${Math.random().toString(36).slice(2, 9).toUpperCase()}`, fullName: 'Test User', dateOfBirth: '1990-05-05', country: 'GB', fileRef: ref });
  if (sub.status !== 201) throw new Error(`kyc submit failed ${sub.res.body}`);
  const pending = await api(app, admin, 'GET', '/admin/kyc/pending');
  const mine = pending.body.submissions.find((x: any) => x.user.id === s.user.id);
  const dec = await api(app, admin, 'POST', `/admin/kyc/${mine.id}/decision`, { decision: 'approve' });
  if (dec.status !== 200) throw new Error(`kyc decision failed ${dec.res.body}`);
  return s;
}
