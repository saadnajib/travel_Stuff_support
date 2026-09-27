import type { CarryLinkClient } from './carrylink.js';
import type { AgentTool, LLM, RunOutput } from './llm.js';
import type { FiledProposal, ToolContext } from './tools.js';

export interface AgentRunResult {
  agent: string;
  skipped: boolean;
  reason?: string;
  summary: string;
  filed: FiledProposal[];
  toolCalls: number;
  usage: RunOutput['usage'];
  durationMs: number;
}

export interface AgentEnv {
  api: CarryLinkClient;
  llm: LLM;
  dryRun: boolean;
  maxItems: number;
  maxIterations: number;
  now: () => Date;
}

/**
 * An AI employee. `prepare` gathers the work queue deterministically (and returns null when there is nothing to
 * do, so no model call is made); `tools` are what the model may call; `system` is the standing job description.
 */
export interface AgentDefinition {
  name: string;
  title: string;
  system: string;
  prepare: (env: AgentEnv) => Promise<{ brief: string } | null>;
  tools: (ctx: ToolContext) => AgentTool[];
}

export const HOUSE_RULES = `You are a member of the CarryLink operations team. CarryLink is a marketplace where identity-verified travellers carry inspected, declared items (documents, buy-for-me purchases, inspected gifts and electronics, prescription medicine) or accompany people, for senders who pay a reward into escrow. Nothing sealed is ever allowed.

How the team works:
- You never execute decisions. You file proposals with file_proposal. The founder (CEO) approves the important ones in the admin console; a server-side policy may auto-execute low-risk, high-confidence items.
- Be specific and cite evidence (ids, timestamps, counts, quotes from chat). Never invent facts; if data is missing, say so and lower your confidence.
- Confidence is calibrated: 0.9+ means you would bet the company on it. Risk is the harm if you are wrong.
- One proposal per item. If file_proposal says a proposal already exists, move on.
- Do not file a proposal when the right action is "do nothing"; explain that in your summary instead.
- Finish with a short plain-English summary for the founder: what you reviewed, what you filed, what needs their attention.`;

export async function runAgent(def: AgentDefinition, env: AgentEnv): Promise<AgentRunResult> {
  const started = Date.now();
  const prep = await def.prepare(env);
  if (!prep) {
    return { agent: def.name, skipped: true, reason: 'nothing to review', summary: '', filed: [], toolCalls: 0, usage: { input: 0, output: 0, cacheRead: 0 }, durationMs: Date.now() - started };
  }
  const ctx: ToolContext = { api: env.api, agent: def.name, dryRun: env.dryRun, filed: [] };
  const out = await env.llm.run({
    system: `${HOUSE_RULES}\n\nYour role: ${def.title}.\n${def.system}`,
    user: `${prep.brief}\n\nToday is ${env.now().toISOString().slice(0, 10)}.`,
    tools: def.tools(ctx),
    maxIterations: env.maxIterations,
  });
  return { agent: def.name, skipped: false, summary: out.text, filed: ctx.filed, toolCalls: out.toolCalls, usage: out.usage, durationMs: Date.now() - started };
}
