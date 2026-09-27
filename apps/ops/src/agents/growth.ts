import type { AgentDefinition, AgentEnv } from '../agent.js';
import { proposalTool, readTools } from '../tools.js';

interface Req { id: string; originCountry: string; destCountry: string; category: string; neededByDate: string; rewardMinor: number; weightKg: number }
interface Trip { id: string; originCountry: string; destCountry: string; departDate: string; capacityKg: number; allowedCategories: string[] }

export const growth: AgentDefinition = {
  name: 'growth',
  title: 'Growth & Community Manager',
  system: `You keep supply and demand balanced per corridor and write community posts the founder can paste into WhatsApp groups. You file outreach_draft proposals; nothing is posted automatically.

Method:
1. Group open requests and verified trips by corridor (origin country -> destination country).
2. A demand gap: requests with no verified trip departing before their needed-by date that allows their category and has capacity. Draft a post recruiting travellers on that corridor: mention the route, dates, category (never item details or names), reward range, and that everything is inspected, escrow-protected and identity-verified.
3. A supply gap: trips with spare capacity and no open requests. Draft a post inviting senders on that corridor.
4. One draft per corridor per gap type, at most 4 drafts per run. Short (under 90 words), warm, no hype, no emojis beyond one, ends with the site link placeholder {LINK}. Never include personal data.
5. If corridors are balanced, file nothing and say so.`,
  prepare: async (env: AgentEnv) => {
    const [{ requests }, { trips }, stats] = await Promise.all([
      env.api.get<{ requests: Req[] }>('/requests?pageSize=50'),
      env.api.get<{ trips: Trip[] }>('/trips?pageSize=50'),
      env.api.get('/ops/stats'),
    ]);
    if (requests.length === 0 && trips.length === 0) return null;
    const recent = await env.api.get<{ proposals: { createdAt: string; title: string; status: string }[] }>('/ops/proposals?status=all&kind=outreach_draft&limit=20');
    const cutoff = new Date(env.now().getTime() - 3 * 86_400_000).toISOString();
    const recentDrafts = recent.proposals.filter((p) => p.createdAt > cutoff);
    return {
      brief: `Open requests (${requests.length}):\n${JSON.stringify(requests.map((r) => ({ id: r.id, corridor: `${r.originCountry}->${r.destCountry}`, category: r.category, neededBy: r.neededByDate, rewardMinor: r.rewardMinor, weightKg: r.weightKg })), null, 1)}\n\nVerified trips (${trips.length}):\n${JSON.stringify(trips.map((t) => ({ id: t.id, corridor: `${t.originCountry}->${t.destCountry}`, departs: t.departDate, capacityKg: t.capacityKg, categories: t.allowedCategories })), null, 1)}\n\nStats:\n${JSON.stringify(stats, null, 1)}\n\nDrafts filed in the last 3 days (do not repeat the same corridor/gap):\n${JSON.stringify(recentDrafts, null, 1)}`,
    };
  },
  tools: (ctx) => [
    ...readTools(ctx),
    proposalTool(ctx, 'outreach_draft', {
      type: 'object',
      properties: {
        channel: { type: 'string', enum: ['whatsapp', 'email', 'other'] },
        audience: { type: 'string', description: 'Who this is for, e.g. "UK-Pakistan community groups, London".' },
        text: { type: 'string', description: 'The post, ready to paste.' },
      },
      required: ['channel', 'audience', 'text'],
      additionalProperties: false,
    }, 'File a community post draft for the founder to publish.'),
  ],
};
