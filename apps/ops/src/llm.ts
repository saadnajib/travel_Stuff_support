import Anthropic from '@anthropic-ai/sdk';
import type { Effort } from './config.js';

/** A tool the model may call. `run` returns a string that goes back to the model verbatim. */
export interface AgentTool {
  name: string;
  description: string;
  input_schema: Anthropic.Beta.BetaTool['input_schema'];
  run: (input: Record<string, unknown>) => Promise<string>;
}

export interface RunInput {
  system: string;
  user: string;
  tools: AgentTool[];
  maxIterations: number;
}

export interface RunOutput {
  text: string;
  toolCalls: number;
  stopReason: string;
  usage: { input: number; output: number; cacheRead: number };
}

export interface LLM {
  run(input: RunInput): Promise<RunOutput>;
}

/**
 * Claude via the Messages API with a manual tool loop. Non-streaming with a bounded max_tokens keeps each
 * request well under the SDK timeout; tool results always go back in a single user turn.
 */
export class AnthropicLLM implements LLM {
  private readonly client: Anthropic;
  constructor(private readonly opts: { model: string; effort: Effort; apiKey?: string }) {
    this.client = new Anthropic(opts.apiKey ? { apiKey: opts.apiKey } : {});
  }

  async run(input: RunInput): Promise<RunOutput> {
    const tools: Anthropic.Beta.BetaTool[] = input.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema }));
    const byName = new Map(input.tools.map((t) => [t.name, t]));
    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: input.user }];
    const usage = { input: 0, output: 0, cacheRead: 0 };
    let toolCalls = 0;
    let finalText = '';
    let stopReason = 'max_iterations';

    for (let i = 0; i < input.maxIterations; i++) {
      const response = await this.client.beta.messages.create({
        model: this.opts.model,
        max_tokens: 16000,
        // Server-side refusal fallback: if a safety classifier declines, the same request is re-run on a fallback model.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        thinking: { type: 'adaptive' },
        output_config: { effort: this.opts.effort },
        system: [{ type: 'text', text: input.system, cache_control: { type: 'ephemeral' } }],
        tools,
        messages,
      });
      usage.input += response.usage.input_tokens;
      usage.output += response.usage.output_tokens;
      usage.cacheRead += response.usage.cache_read_input_tokens ?? 0;
      stopReason = response.stop_reason ?? 'unknown';

      for (const block of response.content) if (block.type === 'text') finalText += block.text;

      if (response.stop_reason === 'pause_turn') {
        messages.push({ role: 'assistant', content: response.content });
        continue;
      }
      if (response.stop_reason !== 'tool_use') break;

      const uses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
      messages.push({ role: 'assistant', content: response.content });
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const use of uses) {
        toolCalls++;
        const tool = byName.get(use.name);
        if (!tool) {
          results.push({ type: 'tool_result', tool_use_id: use.id, content: `Unknown tool ${use.name}`, is_error: true });
          continue;
        }
        try {
          const out = await tool.run((use.input ?? {}) as Record<string, unknown>);
          results.push({ type: 'tool_result', tool_use_id: use.id, content: out });
        } catch (e) {
          results.push({ type: 'tool_result', tool_use_id: use.id, content: e instanceof Error ? e.message : String(e), is_error: true });
        }
      }
      messages.push({ role: 'user', content: results });
    }
    return { text: finalText.trim(), toolCalls, stopReason, usage };
  }
}

/** Scripted stand-in for tests and dry runs without an API key: calls the tools a script decides, then returns text. */
export class FakeLLM implements LLM {
  constructor(private readonly script: (input: RunInput) => Promise<{ calls: { tool: string; input: Record<string, unknown> }[]; text: string }>) {}

  async run(input: RunInput): Promise<RunOutput> {
    const plan = await this.script(input);
    let toolCalls = 0;
    const outputs: string[] = [];
    for (const call of plan.calls) {
      const tool = input.tools.find((t) => t.name === call.tool);
      if (!tool) throw new Error(`FakeLLM: unknown tool ${call.tool}`);
      toolCalls++;
      outputs.push(await tool.run(call.input));
    }
    return { text: `${plan.text}\n${outputs.join('\n')}`.trim(), toolCalls, stopReason: 'end_turn', usage: { input: 0, output: 0, cacheRead: 0 } };
  }
}
