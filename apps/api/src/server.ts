import { buildApp } from './app.js';
import { config } from './config.js';
import { MockPaymentProvider } from './domain/payments.js';
import { sweepAutoComplete } from './routes/matches.js';

const app = await buildApp();
try {
  await app.listen({ port: config.port, host: config.host });
  app.log.info(`CarryLink API listening on http://${config.host}:${config.port}/api/v1`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

// Dispute-window sweep: releases escrow on delivered matches older than the window.
const payments = new MockPaymentProvider();
const sweep = setInterval(() => {
  sweepAutoComplete(app.db, payments).catch((e) => app.log.error(e));
}, 10 * 60_000);
sweep.unref();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await app.close();
    process.exit(0);
  });
}
