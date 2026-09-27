import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  scrypt as scryptCb,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';
import { config } from '../config.js';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64, SCRYPT_PARAMS);
  return `scrypt$${SCRYPT_PARAMS.N}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[2], 'base64');
  const expected = Buffer.from(parts[3], 'base64');
  const actual = await scrypt(password, salt, expected.length, { ...SCRYPT_PARAMS, N: Number(parts[1]) });
  return safeEqual(actual, expected);
}

export function safeEqual(a: Buffer | string, b: Buffer | string): boolean {
  const ab = typeof a === 'string' ? Buffer.from(a) : a;
  const bb = typeof b === 'string' ? Buffer.from(b) : b;
  if (ab.length !== bb.length) {
    // still burn comparable time
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

export function sha256Hex(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

/** Keyed hash for lookups of secrets (tokens, codes) so a DB leak does not reveal them. */
export function hmacHex(input: string): string {
  return createHmac('sha256', config.jwtSecret).update(input).digest('hex');
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function randomSixDigitCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

// ---- field-level encryption (AES-256-GCM) ----
export function encryptField(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', config.fieldKey, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64')}.${tag.toString('base64')}.${ct.toString('base64')}`;
}

export function decryptField(enc: string): string {
  const [v, ivB64, tagB64, ctB64] = enc.split('.');
  if (v !== 'v1') throw new Error('Unsupported ciphertext version');
  const decipher = createDecipheriv('aes-256-gcm', config.fieldKey, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
}

export function last4(s: string): string {
  const digits = s.replace(/\D/g, '');
  const src = digits.length >= 4 ? digits : s;
  return src.slice(-4);
}

export function maskPhone(last: string | null): string | null {
  return last ? `••• ••• ${last}` : null;
}

// ---- minimal HS256 JWT ----
export interface AccessClaims {
  sub: string;
  role: 'user' | 'admin' | 'ops';
  iat: number;
  exp: number;
  typ: 'access';
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

export function signJwt(claims: Omit<AccessClaims, 'iat' | 'exp' | 'typ'>, ttlSec: number): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: AccessClaims = { ...claims, iat: now, exp: now + ttlSec, typ: 'access' };
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac('sha256', config.jwtSecret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

export function verifyJwt(token: string): AccessClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const expected = createHmac('sha256', config.jwtSecret).update(`${header}.${body}`).digest('base64url');
  if (!safeEqual(sig, expected)) return null;
  try {
    const hdr = JSON.parse(Buffer.from(header, 'base64url').toString('utf8'));
    if (hdr.alg !== 'HS256') return null;
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as AccessClaims;
    if (claims.typ !== 'access') return null;
    if (typeof claims.exp !== 'number' || claims.exp <= Math.floor(Date.now() / 1000)) return null;
    if (typeof claims.sub !== 'string') return null;
    return claims;
  } catch {
    return null;
  }
}
