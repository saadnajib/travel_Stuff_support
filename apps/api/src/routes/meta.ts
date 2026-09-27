import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { CATEGORIES, FEES, PROHIBITED_KEYWORDS } from '../domain/categories.js';

export async function metaRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => ({ ok: true, version: config.version }));
  app.get('/meta/categories', async () => ({ categories: CATEGORIES }));
  app.get('/meta/prohibited', async () => ({ items: PROHIBITED_KEYWORDS }));
  app.get('/meta/fees', async () => ({
    platformFeePct: FEES.platformFeePct,
    protectionFeeMinor: FEES.protectionFeeMinor,
    minRewardMinor: FEES.minRewardMinor,
    maxRewardMinor: FEES.maxRewardMinor,
    maxTripCapacityKg: FEES.maxTripCapacityKg,
  }));
}
