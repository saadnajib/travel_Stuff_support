import type { AgentDefinition, AgentEnv } from '../agent.js';
import { proposalTool, readTools } from '../tools.js';

interface Dispute { id: string; matchId: string; openedBy: string; reason: string; details: string; createdAt: string; match: { id: string; status: string; agreedRewardMinor: number; currency: string } }

export const disputeOfficer: AgentDefinition = {
  name: 'dispute-officer',
  title: 'Dispute Officer',
  system: `You resolve disputes between senders and travellers fairly, from evidence, and file one dispute_resolution proposal per open dispute.

Decision rules (in order):
1. Escrow protects the sender until delivery is confirmed. If the traveller never confirmed handover (no in_transit event, no inspection photos) and the sender claims a no-show, refund_sender unless chat shows the sender failed to appear.
2. If handover happened (inspection notes + photos) and the delivery code was entered, the goods reached the recipient: pay_traveler unless the sender shows the items differ from the declaration.
3. Automatic disputes from 5 wrong codes: check chat for who had the code. A traveller guessing codes without handover is a red flag; a sender who never shared the delivery code after delivery is stalling.
4. Partial delivery, damage with shared fault, or evidence that is genuinely balanced: split.
5. Suspected prohibited items (suspected_prohibited): never pay_traveler; refund_sender and flag in reasoning for trust-safety.
6. Use both parties' histories (disputes lost, redacted messages, trust score) as tie-breakers only, never as primary evidence.

Confidence: 0.9+ only when timeline, chat and photos all point the same way. Amount matters: small, clear-cut cases may auto-execute under policy, so be conservative with confidence on anything ambiguous. Write notes the parties will read.`,
  prepare: async (env: AgentEnv) => {
    const { disputes } = await env.api.get<{ disputes: Dispute[] }>('/admin/disputes?status=open');
    const existing = await env.api.get<{ proposals: { targetId: string | null; status: string }[] }>('/ops/proposals?status=all&kind=dispute_resolution&limit=200');
    const done = new Set(existing.proposals.filter((p) => p.status !== 'rejected').map((p) => p.targetId));
    const queue = disputes.filter((d) => !done.has(d.id)).slice(0, env.maxItems);
    if (queue.length === 0) return null;
    const contexts = await Promise.all(queue.map((d) => env.api.get(`/ops/context/match/${d.matchId}`)));
    return {
      brief: `There are ${queue.length} open disputes without a proposal. Review each with its full match context and file one dispute_resolution proposal per dispute. Include disputeId and matchId in the payload.\n\nDisputes:\n${JSON.stringify(queue.map(({ match, ...d }) => ({ ...d, matchStatus: match.status, rewardMinor: match.agreedRewardMinor, currency: match.currency })), null, 1)}\n\nMatch contexts (same order):\n${JSON.stringify(contexts, null, 1)}`,
    };
  },
  tools: (ctx) => [
    ...readTools(ctx),
    proposalTool(ctx, 'dispute_resolution', {
      type: 'object',
      properties: {
        disputeId: { type: 'string' },
        matchId: { type: 'string' },
        resolution: { type: 'string', enum: ['refund_sender', 'pay_traveler', 'split'] },
        notes: { type: 'string', description: 'Resolution note both parties will read. State the evidence.' },
      },
      required: ['disputeId', 'matchId', 'resolution', 'notes'],
      additionalProperties: false,
    }, 'File a dispute resolution proposal for one open dispute.'),
  ],
};
