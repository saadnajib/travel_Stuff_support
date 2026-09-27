import type { AgentDefinition, AgentEnv } from '../agent.js';
import { proposalTool, readTools } from '../tools.js';

interface Submission { id: string; user: { id: string; name: string; trustScore: number; memberSince: string }; docType: string; docNumberLast4: string; fullName: string; dateOfBirth: string; country: string; submittedAt: string }

export const identityReviewer: AgentDefinition = {
  name: 'identity-reviewer',
  title: 'Identity Reviewer (KYC)',
  system: `You review pending identity-verification submissions and file one kyc_decision proposal per submission.

What you check (you only have metadata, not the document image):
1. The name on the document matches the account name (allow ordering, diacritics, middle names, common transliterations). A clear mismatch is a reject.
2. Date of birth implies age 18+ and is plausible.
3. Country and document type make sense together and against the account's activity.
4. Signals in the user's context: duplicate-document audit entries (kyc.duplicate_document), earlier rejections, failed logins, refresh-token reuse, suspicious speed (account created minutes ago, immediately posting high-value requests).
5. If everything is consistent, propose approve with confidence reflecting how much evidence you actually have. Approvals always wait for the founder, so say plainly what you could not verify (the image itself).

Rejections need a reason the applicant can act on ("Name on document does not match account name; update your profile name or resubmit with the matching document"). Never reject for a missing image check alone; that is the founder's call.`,
  prepare: async (env: AgentEnv) => {
    const { submissions } = await env.api.get<{ submissions: Submission[] }>('/admin/kyc/pending');
    const existing = await env.api.get<{ proposals: { targetId: string | null }[] }>('/ops/proposals?status=all&kind=kyc_decision&limit=200');
    const done = new Set(existing.proposals.map((p) => p.targetId));
    const queue = submissions.filter((s) => !done.has(s.id)).slice(0, env.maxItems);
    if (queue.length === 0) return null;
    const contexts = await Promise.all(queue.map((s) => env.api.get(`/ops/context/user/${s.user.id}`)));
    return {
      brief: `There are ${queue.length} pending identity submissions without a decision. For each, file one kyc_decision proposal (or explain why you are filing none). Include the applicant's userId in the payload.\n\nSubmissions:\n${JSON.stringify(queue, null, 1)}\n\nApplicant contexts (same order):\n${JSON.stringify(contexts, null, 1)}`,
    };
  },
  tools: (ctx) => [
    ...readTools(ctx),
    proposalTool(ctx, 'kyc_decision', {
      type: 'object',
      properties: {
        submissionId: { type: 'string' },
        userId: { type: 'string' },
        decision: { type: 'string', enum: ['approve', 'reject'] },
        reason: { type: 'string', description: 'Required for reject. Actionable for the applicant.' },
      },
      required: ['submissionId', 'userId', 'decision'],
      additionalProperties: false,
    }, 'File a KYC decision proposal for one submission.'),
  ],
};
