import { CarryLinkClient } from './carrylink.js';
import { config } from './config.js';
import { AnthropicLLM } from './llm.js';
import type { AgentEnv } from './agent.js';
import { TEAM, daemon, runTeam } from './team.js';

const [cmd = 'help', ...rest] = process.argv.slice(2);
const log = (line: string) => console.log(line);

function buildEnv(): AgentEnv {
  if (!config.dryRun && !process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    log('Note: no ANTHROPIC_API_KEY in the environment; the SDK will try an `ant auth login` profile.');
  }
  return {
    api: new CarryLinkClient({ baseUrl: config.apiUrl, email: config.email, password: config.password }),
    llm: new AnthropicLLM({ model: config.model, effort: config.effort }),
    dryRun: config.dryRun,
    maxItems: config.maxItemsPerRun,
    maxIterations: config.maxIterations,
    now: () => new Date(),
  };
}

switch (cmd) {
  case 'run': {
    const env = buildEnv();
    const me = await env.api.login();
    log(`Logged in as ${me.role} account. Model ${config.model}, effort ${config.effort}${config.dryRun ? ', DRY RUN (nothing will be filed)' : ''}.`);
    const results = await runTeam(env, rest, log);
    const filed = results.reduce((n, r) => n + r.filed.length, 0);
    const tokens = results.reduce((n, r) => n + r.usage.input + r.usage.output, 0);
    log(`\nDone: ${results.filter((r) => !r.skipped).length} agent(s) worked, ${results.filter((r) => r.skipped).length} had nothing to do, ${filed} proposal(s) filed, ${tokens} tokens.`);
    break;
  }
  case 'daemon': {
    const env = buildEnv();
    await env.api.login();
    log(`AI team daemon: every ${config.intervalMinutes} min, digest at ${config.digestHour}:00, model ${config.model}${config.dryRun ? ', DRY RUN' : ''}. Ctrl+C to stop.`);
    await daemon(env, { intervalMinutes: config.intervalMinutes, digestHour: config.digestHour }, log);
    break;
  }
  case 'list': {
    for (const a of TEAM) log(`${a.name.padEnd(18)} ${a.title}`);
    break;
  }
  default:
    log(`CarryLink AI operations team
Usage:
  npm run ops -w apps/ops -- run [agent ...]   run every agent once (or only the named ones)
  npm run ops -w apps/ops -- daemon            keep running on a schedule
  npm run ops -w apps/ops -- list              list the team
Env: ANTHROPIC_API_KEY, CARRYLINK_API_URL, OPS_EMAIL, OPS_PASSWORD, OPS_MODEL, OPS_EFFORT, OPS_INTERVAL_MINUTES, OPS_DIGEST_HOUR, OPS_DRY_RUN, OPS_MAX_ITEMS_PER_RUN`);
}
