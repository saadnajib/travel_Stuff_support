import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { config } from './config.js';
import { Db, migrate } from './db.js';
import { MockPaymentProvider, type PaymentProvider } from './domain/payments.js';
import { AppError } from './lib/errors.js';
import { loadUser } from './plugins/auth.js';
import { adminRoutes } from './routes/admin.js';
import { authRoutes } from './routes/auth.js';
import { kycRoutes } from './routes/kyc.js';
import { matchRoutes } from './routes/matches.js';
import { metaRoutes } from './routes/meta.js';
import { opsRoutes } from './routes/ops.js';
import { requestRoutes } from './routes/requests.js';
import { tripRoutes } from './routes/trips.js';
import { uploadRoutes } from './routes/uploads.js';
import './types.js';

export interface BuildOptions {
  db?: Db;
  payments?: PaymentProvider;
  logger?: boolean;
  /** Defaults to on except under NODE_ENV=test, where suites share one IP. */
  rateLimits?: boolean;
}

export async function buildApp(opts: BuildOptions = {}): Promise<FastifyInstance> {
  const db = opts.db ?? new Db();
  migrate(db);
  const payments = opts.payments ?? new MockPaymentProvider();

  const app = Fastify({
    logger: opts.logger ?? !config.isTest,
    trustProxy: true,
    bodyLimit: 256 * 1024,
  });

  app.decorate('db', db);
  app.decorateRequest('user', null);

  await app.register(helmet, {
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: 'same-site' },
    referrerPolicy: { policy: 'no-referrer' },
  });
  await app.register(cors, {
    origin: config.corsOrigin,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });
  await app.register(cookie, { hook: 'onRequest' });
  const rateLimitsOn = opts.rateLimits ?? !config.isTest;
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    allowList: () => !rateLimitsOn,
    errorResponseBuilder: () => ({ statusCode: 429, code: 'RATE_LIMITED', message: 'Too many requests, slow down' }),
  });

  app.addHook('onRequest', async (req) => {
    req.user = loadUser(req);
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message, ...(err.details !== undefined ? { details: err.details } : {}) } });
    }
    const e = err as { statusCode?: number; code?: string; message?: string; validation?: unknown };
    if (e.statusCode === 429) return reply.code(429).send({ error: { code: 'RATE_LIMITED', message: 'Too many requests, slow down' } });
    if (e.statusCode && e.statusCode >= 400 && e.statusCode < 500) {
      return reply.code(e.statusCode).send({ error: { code: e.code ?? 'BAD_REQUEST', message: e.message ?? 'Bad request' } });
    }
    req.log.error(err);
    return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } });
  });

  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Route not found' } }));

  await app.register(
    async (v1) => {
      await v1.register(metaRoutes);
      await v1.register(authRoutes);
      await v1.register(kycRoutes);
      await v1.register(uploadRoutes);
      await v1.register(tripRoutes);
      await v1.register(requestRoutes);
      await v1.register(matchRoutes, { payments });
      await v1.register(adminRoutes, { payments });
      await v1.register(opsRoutes, { payments });
    },
    { prefix: '/api/v1' },
  );

  app.addHook('onClose', async () => db.close());
  return app;
}
