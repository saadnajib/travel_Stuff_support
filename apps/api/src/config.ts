import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

function loadDotEnv(): void {
  const candidates = [path.resolve(process.cwd(), '.env'), path.resolve(process.cwd(), 'apps/api/.env')];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    for (const raw of readFileSync(file, 'utf8').split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      const value = line.slice(eq + 1).trim().replace(/^"(.*)"$/, '$1');
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}
loadDotEnv();

const isProd = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';

function required(name: string, devDefault: string): string {
  const v = process.env[name];
  if (v && v.length > 0) return v;
  if (isProd) throw new Error(`Missing required env var ${name}`);
  return devDefault;
}

const jwtSecret = required('JWT_SECRET', 'dev-only-jwt-secret-do-not-use-in-production-please');
if (jwtSecret.length < 32) throw new Error('JWT_SECRET must be at least 32 characters');

// Dev fallback derives a stable key from JWT_SECRET so encrypted fields survive restarts. Production must set it explicitly.
const fieldKeyB64 = required('FIELD_ENCRYPTION_KEY', createHash('sha256').update(`${jwtSecret}:field-key`).digest('base64'));
const fieldKey = Buffer.from(fieldKeyB64, 'base64');
if (fieldKey.length !== 32) throw new Error('FIELD_ENCRYPTION_KEY must decode to exactly 32 bytes (base64)');

export const config = {
  isProd,
  isTest,
  port: Number(process.env.PORT ?? 4000),
  host: process.env.HOST ?? '0.0.0.0',
  databasePath: isTest ? ':memory:' : (process.env.DATABASE_PATH ?? path.resolve(process.cwd(), 'data/carrylink.db')),
  jwtSecret,
  fieldKey,
  corsOrigin: (process.env.CORS_ORIGIN ?? 'http://localhost:5173').split(',').map((s) => s.trim()),
  cookieSecure: process.env.COOKIE_SECURE === 'true' || isProd,
  devReturnTokens: !isProd && process.env.DEV_RETURN_TOKENS !== 'false',
  accessTokenTtlSec: 15 * 60,
  refreshTokenTtlSec: 30 * 24 * 60 * 60,
  emailTokenTtlSec: 24 * 60 * 60,
  disputeWindowHours: 48,
  ops: {
    autoExecute: process.env.OPS_AUTO_EXECUTE !== 'false',
    autoDisputeMaxMinor: Number(process.env.OPS_AUTO_DISPUTE_MAX_MINOR ?? 5000),
    autoMinConfidence: Number(process.env.OPS_AUTO_MIN_CONFIDENCE ?? 0.9),
  },
  codeMaxAttempts: 5,
  version: '0.1.0',
} as const;
