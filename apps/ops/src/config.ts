import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

function loadDotEnv(): void {
  for (const file of [path.resolve(process.cwd(), '.env'), path.resolve(process.cwd(), 'apps/ops/.env')]) {
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

export type Effort = 'low' | 'medium' | 'high';

export const config = {
  apiUrl: (process.env.CARRYLINK_API_URL ?? 'http://localhost:4000/api/v1').replace(/\/$/, ''),
  email: process.env.OPS_EMAIL ?? 'ops@carrylink.dev',
  password: process.env.OPS_PASSWORD ?? 'Ops-Passw0rd!',
  model: process.env.OPS_MODEL ?? 'claude-opus-5',
  effort: (process.env.OPS_EFFORT ?? 'medium') as Effort,
  intervalMinutes: Number(process.env.OPS_INTERVAL_MINUTES ?? 30),
  digestHour: Number(process.env.OPS_DIGEST_HOUR ?? 8),
  dryRun: process.env.OPS_DRY_RUN === 'true',
  maxItemsPerRun: Number(process.env.OPS_MAX_ITEMS_PER_RUN ?? 20),
  maxIterations: Number(process.env.OPS_MAX_ITERATIONS ?? 24),
};
