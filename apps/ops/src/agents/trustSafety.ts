import type { AgentDefinition, AgentEnv } from '../agent.js';
import { proposalTool, readTools } from '../tools.js';

interface AuditEntry { actorId: string | null; action: string; entityId: string | null; createdAt: string }

const THRESHOLDS = { 'message.redacted': 3, 'match.code_failed': 5, 'auth.refresh_reuse_detected': 1, 'kyc.duplicate_document': 1 } as const;

export const trustSafety: AgentDefinition = {
  name: 'trust-safety',
  title: 'Trust & Safety Analyst',
  system: `You look for accounts that endanger other users or the platform, and file user_suspension proposals. Suspensions always wait for the founder, so your job is to make the case clearly, or to decide that no action is warranted.

Patterns that justify a suspension proposal:
- Repeated attempts to move deals off-platform (several redacted messages in a short window), especially before escrow is funded.
- Guessing handover or delivery codes (many code failures), or a locked match with no plausible explanation in chat.
- Identity abuse: duplicate-document attempts, refresh-token reuse (possible account takeover: recommend suspension until the user re-verifies), multiple rejections.
- Requests that describe prohibited or sealed items even after the keyword screen (read the description).
- Losing repeated disputes as the same party.

Patterns that do NOT justify suspension on their own: one redacted message, a single wrong code, a new account, a low trust score. Prefer recommending "watch" in your summary over a proposal when the evidence is thin. Risk is 'high' when the account has money in escrow or open matches (suspension freezes their deals).`,
  prepare: async (env: AgentEnv) => {
    const { entries } = await env.api.get<{ entries: AuditEntry[] }>('/admin/audit?limit=500');
    const perUser = new Map<string, Record<string, number>>();
    for (const e of entries) {
      const key = (e.action in THRESHOLDS ? (e.actorId ?? e.entityId) : null);
      if (!key) continue;
      const rec = perUser.get(key) ?? {};
      rec[e.action] = (rec[e.action] ?? 0) + 1;
      perUser.set(key, rec);
    }
    const flagged = [...perUser.entries()].filter(([, rec]) => Object.entries(THRESHOLDS).some(([a, t]) => (rec[a] ?? 0) >= t));
    if (flagged.length === 0) return null;
    const existing = await env.api.get<{ proposals: { targetId: string | null; status: string }[] }>('/ops/proposals?status=all&kind=user_suspension&limit=200');
    const done = new Set(existing.proposals.filter((p) => p.status !== 'rejected').map((p) => p.targetId));
    const queue = flagged.filter(([id]) => !done.has(id)).slice(0, env.maxItems);
    if (queue.length === 0) return null;
    const contexts = await Promise.all(queue.map(([id]) => env.api.get<{ user: { user: { suspended: boolean } } }>(`/ops/context/user/${id}`).catch(() => null)));
    const items = queue.map(([id, signals], i) => ({ userId: id, signals, context: contexts[i] })).filter((x) => x.context && !x.context.user.user.suspended);
    if (items.length === 0) return null;
    return {
      brief: `${items.length} accounts crossed a safety threshold in the recent audit log. For each, decide: file a user_suspension proposal, or recommend "watch" in your summary with the reason.\n\nThresholds: ${JSON.stringify(THRESHOLDS)}\n\nFlagged accounts with signals and full context:\n${JSON.stringify(items, null, 1)}`,
    };
  },
  tools: (ctx) => [
    ...readTools(ctx),
    proposalTool(ctx, 'user_suspension', {
      type: 'object',
      properties: {
        userId: { type: 'string' },
        suspended: { type: 'boolean', description: 'true to suspend, false to lift a suspension.' },
        reason: { type: 'string', description: 'Shown in the audit log and to the founder.' },
      },
      required: ['userId', 'suspended', 'reason'],
      additionalProperties: false,
    }, 'Propose suspending (or unsuspending) one user.'),
  ],
};
