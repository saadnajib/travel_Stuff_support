import type { FastifyReply, FastifyRequest } from 'fastify';
import { verifyJwt } from '../lib/crypto.js';
import { errors } from '../lib/errors.js';
import type { AuthUser } from '../types.js';

export function loadUser(req: FastifyRequest): AuthUser | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  const claims = verifyJwt(header.slice(7).trim());
  if (!claims) return null;
  const row = req.server.db.get(
    `SELECT id, email, name, role, email_verified, kyc_status, suspended FROM users WHERE id = ?`,
    [claims.sub],
  );
  if (!row) return null;
  return {
    id: row.id as string,
    email: row.email as string,
    name: row.name as string,
    role: row.role as 'user' | 'admin',
    emailVerified: row.email_verified === 1,
    kycStatus: row.kyc_status as AuthUser['kycStatus'],
    suspended: row.suspended === 1,
  };
}

export async function requireAuth(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
  if (!req.user) throw errors.unauthorized();
  if (req.user.suspended) throw errors.suspended();
}

export async function requireVerifiedEmail(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  await requireAuth(req, reply);
  if (!req.user!.emailVerified) throw errors.emailNotVerified();
}

export async function requireKyc(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  await requireVerifiedEmail(req, reply);
  if (req.user!.kycStatus !== 'verified') throw errors.kycRequired();
}

export async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  await requireAuth(req, reply);
  if (req.user!.role !== 'admin') throw errors.forbidden();
}

export function assertUser(req: FastifyRequest): AuthUser {
  if (!req.user) throw errors.unauthorized();
  return req.user;
}
