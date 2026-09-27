import type { CarryLinkClient } from './carrylink.js';
import { CarryLinkError } from './carrylink.js';
import type { AgentTool } from './llm.js';

export type ProposalKind = 'kyc_decision' | 'dispute_resolution' | 'user_suspension' | 'outreach_draft' | 'report';

export interface ProposalInput {
  kind: ProposalKind;
  targetId?: string;
  title: string;
  reasoning: string;
  confidence: number;
  risk: 'low' | 'medium' | 'high';
  payload: Record<string, unknown>;
}

export interface FiledProposal {
  id: string;
  kind: string;
  title: string;
  status: string;
  autoPolicy: string | null;
  targetId: string | null;
}

export interface ToolContext {
  api: CarryLinkClient;
  agent: string;
  dryRun: boolean;
  filed: FiledProposal[];
}

const json = (v: unknown) => JSON.stringify(v, null, 1);

export function readTools(ctx: ToolContext): AgentTool[] {
  return [
    {
      name: 'get_user_context',
      description: 'Full context on one user: profile, KYC summary, activity counts (matches, disputes opened/lost, redacted messages, code failures) and recent audit entries.',
      input_schema: { type: 'object', properties: { userId: { type: 'string' } }, required: ['userId'], additionalProperties: false },
      run: async (i) => json(await ctx.api.get(`/ops/context/user/${encodeURIComponent(String(i.userId))}`)),
    },
    {
      name: 'get_match_context',
      description: 'Full context on one match: request, trip, timeline, escrow, inspection notes and photo refs, the whole chat, disputes, and both parties’ histories.',
      input_schema: { type: 'object', properties: { matchId: { type: 'string' } }, required: ['matchId'], additionalProperties: false },
      run: async (i) => json(await ctx.api.get(`/ops/context/match/${encodeURIComponent(String(i.matchId))}`)),
    },
    {
      name: 'get_audit_log',
      description: 'Most recent audit-log entries (actions such as auth.login_failed, match.code_failed, message.redacted, kyc.duplicate_document, auth.refresh_reuse_detected).',
      input_schema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 500 } }, additionalProperties: false },
      run: async (i) => json(await ctx.api.get(`/admin/audit?limit=${Number(i.limit ?? 200)}`)),
    },
    {
      name: 'get_stats',
      description: 'Platform KPIs: users, trips, requests by status, matches by status, escrow totals, disputes, last-7-day activity, pending proposals and the auto-execution policy.',
      input_schema: { type: 'object', properties: {}, additionalProperties: false },
      run: async () => json(await ctx.api.get('/ops/stats')),
    },
    {
      name: 'search_requests',
      description: 'Open delivery requests, optionally filtered by origin/destination ISO2 country and category.',
      input_schema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' }, category: { type: 'string' } }, additionalProperties: false },
      run: async (i) => json(await ctx.api.get(`/requests?pageSize=50${qs(i, ['from', 'to', 'category'])}`)),
    },
    {
      name: 'search_trips',
      description: 'Published, verified trips, optionally filtered by origin/destination ISO2 country and category.',
      input_schema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' }, category: { type: 'string' } }, additionalProperties: false },
      run: async (i) => json(await ctx.api.get(`/trips?pageSize=50${qs(i, ['from', 'to', 'category'])}`)),
    },
    {
      name: 'list_proposals',
      description: 'Proposals already filed by the team, to avoid duplicates and to see what the founder decided.',
      input_schema: { type: 'object', properties: { status: { type: 'string', enum: ['pending', 'approved', 'rejected', 'auto_executed', 'failed', 'all'] }, kind: { type: 'string' } }, additionalProperties: false },
      run: async (i) => json(await ctx.api.get(`/ops/proposals?status=${String(i.status ?? 'all')}${i.kind ? `&kind=${String(i.kind)}` : ''}&limit=100`)),
    },
  ];
}

function qs(i: Record<string, unknown>, keys: string[]): string {
  return keys.filter((k) => typeof i[k] === 'string' && (i[k] as string).length > 0).map((k) => `&${k}=${encodeURIComponent(String(i[k]))}`).join('');
}

export async function fileProposal(ctx: ToolContext, p: ProposalInput): Promise<string> {
  if (ctx.dryRun) {
    const fake: FiledProposal = { id: `dry-${ctx.filed.length + 1}`, kind: p.kind, title: p.title, status: 'dry_run', autoPolicy: null, targetId: p.targetId ?? null };
    ctx.filed.push(fake);
    return `DRY RUN: proposal not filed.\n${JSON.stringify({ agent: ctx.agent, ...p }, null, 1)}`;
  }
  try {
    const res = await ctx.api.post<{ proposal: FiledProposal }>('/ops/proposals', { agent: ctx.agent, ...p });
    ctx.filed.push(res.proposal);
    const auto = res.proposal.status === 'auto_executed' ? ` It was executed automatically under policy ${res.proposal.autoPolicy}.` : ' It is waiting for the founder.';
    return `Filed proposal ${res.proposal.id} (${res.proposal.status}).${auto}`;
  } catch (e) {
    if (e instanceof CarryLinkError && e.status === 409) return `Not filed: a proposal for this target already exists. Move on.`;
    if (e instanceof CarryLinkError) return `Not filed (${e.code}): ${e.message} ${e.details ? JSON.stringify(e.details) : ''}`;
    throw e;
  }
}

export function proposalTool(ctx: ToolContext, kind: ProposalKind, payloadSchema: Record<string, unknown>, description: string): AgentTool {
  return {
    name: 'file_proposal',
    description,
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short, specific title (max 200 chars).' },
        reasoning: { type: 'string', description: 'The evidence and the rule you applied, written for the founder. 2-8 sentences.' },
        confidence: { type: 'number', minimum: 0, maximum: 1, description: '0.9+ only when the evidence is unambiguous.' },
        risk: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Harm if this decision is wrong.' },
        payload: payloadSchema,
      },
      required: ['title', 'reasoning', 'confidence', 'risk', 'payload'],
      additionalProperties: false,
    },
    run: async (i) =>
      fileProposal(ctx, {
        kind,
        title: String(i.title),
        reasoning: String(i.reasoning),
        confidence: Number(i.confidence),
        risk: i.risk as 'low' | 'medium' | 'high',
        payload: (i.payload ?? {}) as Record<string, unknown>,
      }),
  };
}
