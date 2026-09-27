import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { nowIso } from '../db.js';
import { audit } from '../lib/audit.js';
import { encryptField, hmacHex, last4 } from '../lib/crypto.js';
import { errors } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { assertUser, requireAuth, requireVerifiedEmail } from '../plugins/auth.js';

const submitSchema = z.object({
  docType: z.enum(['passport', 'national_id', 'driving_licence']),
  docNumber: z.string().trim().min(5).max(30).regex(/^[A-Za-z0-9-]+$/, 'Document number may contain letters, digits and dashes'),
  fullName: z.string().trim().min(2).max(120),
  dateOfBirth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((d) => {
      const dob = new Date(d);
      const age = (Date.now() - dob.getTime()) / (365.25 * 24 * 3600 * 1000);
      return !Number.isNaN(dob.getTime()) && age >= 18 && age < 120;
    }, 'You must be at least 18'),
  country: z.string().regex(/^[A-Z]{2}$/, 'ISO-3166 alpha-2 country code'),
  fileRef: z.string().min(8).max(100),
});

export async function kycRoutes(app: FastifyInstance): Promise<void> {
  app.post('/kyc/submit', { preHandler: requireVerifiedEmail, config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (req, reply) => {
    const user = assertUser(req);
    const body = parse(submitSchema, req.body);
    if (user.kycStatus === 'pending') throw errors.conflict('A verification is already under review');
    if (user.kycStatus === 'verified') throw errors.conflict('Identity already verified');
    const upload = app.db.get(`SELECT ref FROM uploads WHERE ref = ? AND user_id = ?`, [body.fileRef, user.id]);
    if (!upload) throw errors.validation([{ path: 'fileRef', message: 'Unknown upload reference' }]);
    const docHash = hmacHex(`${body.docType}:${body.country}:${body.docNumber.toUpperCase()}`);
    const dup = app.db.get(
      `SELECT user_id FROM kyc_submissions WHERE doc_number_hash = ? AND status = 'verified' AND user_id != ?`,
      [docHash, user.id],
    );
    if (dup) {
      audit(app.db, { actorId: user.id, action: 'kyc.duplicate_document', entity: 'user', entityId: user.id, ip: req.ip });
      throw errors.conflict('This document is already linked to another account');
    }
    const id = randomUUID();
    app.db.transaction(() => {
      app.db.run(
        `INSERT INTO kyc_submissions (id, user_id, doc_type, doc_number_enc, doc_number_last4, doc_number_hash, full_name, date_of_birth, country, file_ref, status, submitted_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,'pending',?)`,
        [id, user.id, body.docType, encryptField(body.docNumber), last4(body.docNumber), docHash, body.fullName, body.dateOfBirth, body.country, body.fileRef, nowIso()],
      );
      app.db.run(`UPDATE users SET kyc_status = 'pending', updated_at = ? WHERE id = ?`, [nowIso(), user.id]);
    });
    audit(app.db, { actorId: user.id, action: 'kyc.submitted', entity: 'kyc', entityId: id, ip: req.ip });
    return reply.code(201).send({ kycStatus: 'pending' });
  });

  app.get('/kyc/status', { preHandler: requireAuth }, async (req) => {
    const user = assertUser(req);
    const latest = app.db.get(
      `SELECT submitted_at, reviewed_at, rejection_reason FROM kyc_submissions WHERE user_id = ? ORDER BY submitted_at DESC LIMIT 1`,
      [user.id],
    );
    return {
      kycStatus: user.kycStatus,
      submittedAt: latest?.submitted_at ?? null,
      reviewedAt: latest?.reviewed_at ?? null,
      rejectionReason: latest?.rejection_reason ?? null,
    };
  });
}
