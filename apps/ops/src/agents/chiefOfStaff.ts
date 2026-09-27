import type { AgentDefinition, AgentEnv } from '../agent.js';
import { proposalTool, readTools } from '../tools.js';

export const chiefOfStaff: AgentDefinition = {
  name: 'chief-of-staff',
  title: 'Chief of Staff',
  system: `You write the founder's daily digest as one report proposal (kind report, period "daily digest <date>"). It must be readable in two minutes on a phone.

Structure (markdown, use these headings):
# Daily digest <date>
## Numbers that matter
A short list: users (verified / total), verified trips, open requests, matches completed (7d), escrow held, disputes open, dispute rate (disputes opened / matches proposed, 7d), fees earned so far.
## What the team did
Per agent: what was reviewed, what was filed, what auto-executed, from the proposals list.
## Waiting for you
Every pending proposal, one line each: kind, title, agent, risk, confidence.
## Anomalies
Anything unusual: spikes in code failures or redacted messages, KYC backlog growing, disputes above 5% of matches, a corridor with demand and no supply, failed proposal executions.
## Three things to do today
Concrete, ordered, each one sentence.

Be factual. Numbers come from the stats and proposals you are given; do not estimate.`,
  prepare: async (env: AgentEnv) => {
    const [stats, pending, recent] = await Promise.all([
      env.api.get('/ops/stats'),
      env.api.get<{ proposals: unknown[] }>('/ops/proposals?status=pending&limit=100'),
      env.api.get<{ proposals: { createdAt: string; kind: string }[] }>('/ops/proposals?status=all&limit=200'),
    ]);
    const since = new Date(env.now().getTime() - 24 * 3_600_000).toISOString();
    const today = recent.proposals.filter((p) => p.createdAt > since && p.kind !== 'report');
    const lastDigest = recent.proposals.find((p) => p.kind === 'report');
    if (lastDigest && lastDigest.createdAt > since) return null; // one digest per day
    return {
      brief: `Write today's digest.\n\nStats:\n${JSON.stringify(stats, null, 1)}\n\nPending proposals (${pending.proposals.length}):\n${JSON.stringify(pending.proposals, null, 1)}\n\nProposals from the last 24h (${today.length}):\n${JSON.stringify(today, null, 1)}`,
    };
  },
  tools: (ctx) => [
    ...readTools(ctx),
    proposalTool(ctx, 'report', {
      type: 'object',
      properties: { period: { type: 'string' }, markdown: { type: 'string' } },
      required: ['period', 'markdown'],
      additionalProperties: false,
    }, 'File the daily digest report.'),
  ],
};
