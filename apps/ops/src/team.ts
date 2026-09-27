import type { AgentDefinition, AgentEnv, AgentRunResult } from './agent.js';
import { runAgent } from './agent.js';
import { chiefOfStaff } from './agents/chiefOfStaff.js';
import { disputeOfficer } from './agents/disputeOfficer.js';
import { growth } from './agents/growth.js';
import { identityReviewer } from './agents/identityReviewer.js';
import { trustSafety } from './agents/trustSafety.js';

export const TEAM: AgentDefinition[] = [identityReviewer, disputeOfficer, trustSafety, growth, chiefOfStaff];

export function findAgent(name: string): AgentDefinition | undefined {
  return TEAM.find((a) => a.name === name);
}

export async function runTeam(env: AgentEnv, names?: string[], log: (line: string) => void = () => {}): Promise<AgentRunResult[]> {
  const agents = names && names.length ? names.map((n) => findAgent(n)).filter((a): a is AgentDefinition => !!a) : TEAM;
  const results: AgentRunResult[] = [];
  for (const def of agents) {
    log(`▶ ${def.name}`);
    try {
      const r = await runAgent(def, env);
      results.push(r);
      if (r.skipped) log(`  skipped: ${r.reason}`);
      else {
        log(`  filed ${r.filed.length} proposal(s), ${r.toolCalls} tool call(s), ${r.usage.input + r.usage.output} tokens, ${(r.durationMs / 1000).toFixed(1)}s`);
        for (const f of r.filed) log(`   - [${f.status}] ${f.kind}: ${f.title}`);
        if (r.summary) log(`  ${r.summary.split('\n').join('\n  ')}`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log(`  error: ${msg}`);
      results.push({ agent: def.name, skipped: false, summary: `error: ${msg}`, filed: [], toolCalls: 0, usage: { input: 0, output: 0, cacheRead: 0 }, durationMs: 0 });
    }
  }
  return results;
}

/** Runs the operational agents every `intervalMinutes` and the chief of staff once a day at `digestHour` (local). */
export async function daemon(env: AgentEnv, opts: { intervalMinutes: number; digestHour: number }, log: (line: string) => void, shouldStop: () => boolean = () => false): Promise<void> {
  const operational = TEAM.filter((a) => a.name !== 'chief-of-staff').map((a) => a.name);
  let lastDigestDay = '';
  while (!shouldStop()) {
    const now = env.now();
    log(`[${now.toISOString()}] team run`);
    await runTeam(env, operational, log);
    const day = now.toISOString().slice(0, 10);
    if (now.getHours() >= opts.digestHour && lastDigestDay !== day) {
      await runTeam(env, ['chief-of-staff'], log);
      lastDigestDay = day;
    }
    await new Promise((r) => setTimeout(r, opts.intervalMinutes * 60_000));
  }
}
