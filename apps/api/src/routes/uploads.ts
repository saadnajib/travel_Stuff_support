import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { nowIso } from '../db.js';
import { randomToken } from '../lib/crypto.js';
import { parse } from '../lib/validate.js';
import { assertUser, requireAuth } from '../plugins/auth.js';

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'];

const schema = z.object({
  filename: z.string().trim().min(1).max(200).regex(/^[^/\\\0]+$/, 'Filename must not contain path separators'),
  contentType: z.enum(ALLOWED as [string, ...string[]]),
  sizeBytes: z.number().int().positive().max(MAX_BYTES),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
});

/**
 * MVP upload broker. In production this returns a short-lived pre-signed URL to object storage, the
 * object is virus-scanned and EXIF-stripped on arrival, and the ref is only usable once the scan passes.
 */
export async function uploadRoutes(app: FastifyInstance): Promise<void> {
  app.post('/uploads', { preHandler: requireAuth, config: { rateLimit: { max: 60, timeWindow: '1 hour' } } }, async (req, reply) => {
    const user = assertUser(req);
    const body = parse(schema, req.body);
    const ref = `upl_${randomToken(16)}`;
    app.db.run(`INSERT INTO uploads (ref, user_id, filename, content_type, size_bytes, sha256, created_at) VALUES (?,?,?,?,?,?,?)`, [
      ref,
      user.id,
      body.filename,
      body.contentType,
      body.sizeBytes,
      body.sha256.toLowerCase(),
      nowIso(),
    ]);
    return reply.code(201).send({ ref, uploadUrl: `mock://storage/${ref}` });
  });
}
