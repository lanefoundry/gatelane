#!/usr/bin/env node
/**
 * gatelane CLI — promotion gate for AI agents.
 *
 * Real engine runner: replay → judge → compare → sign → evaluate.
 *
 * Usage:
 *   gatelane gate --candidate model:gpt-5 --candidate guardrail:v2 \
 *                      --judges gpt-4o,claude-sonnet \
 *                      [--provider mock|openai|anthropic] \
 *                      [--judge-provider mock|openai|anthropic] \
 *                      [--dataset-source redteam|prod|compliance] \
 *                      [--dataset <frozen-dataset.json>] \
 *                      [--baseline <ref>] [--threshold <n>] [--report <p>]
 *   gatelane freeze-slice --window 7d --output dataset.jsonl \
 *                      --endpoint http://localhost:8787 [--token <capture-token>]
 *   gatelane --help
 *
 * Providers:
 *   mock      — deterministic in-process caller (default, no env needed)
 *   openai    — OpenAI Chat Completions (+ any OpenAI-compatible endpoint)
 *   anthropic — Anthropic Messages API
 *
 * Env:
 *   OPENAI_API_KEY / OPENAI_BASE_URL     (provider=openai; BASE_URL enables
 *                                        DeepSeek / Ollama / vLLM / OpenRouter…)
 *   ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL
 *   GATELANE_ENDPOINT / GATELANE_CAPTURE_TOKEN   (freeze-slice defaults)
 *
 * @see docs/distribution.md
 */
import { readFile, writeFile } from 'node:fs/promises';

import {
  freezeDataset,
  HttpStorage,
  type DatasetSourceKind,
  type FrozenDataset,
} from '@lanefoundry/gatelane-sdk';

import { freezeInjectionDataset } from '@lanefoundry/gatelane-engine/attack';
import {
  createRunner,
  MockLLMCaller,
  OpenAIChatCaller,
  AnthropicCaller,
  type LLMCaller,
} from '@lanefoundry/gatelane-engine';

const HELP = `gatelane — promotion gate for AI agents

Usage:
  gatelane gate --candidate <ref> [--candidate <ref> ...] --judges <list>
                [--provider mock|openai|anthropic]
                [--judge-provider mock|openai|anthropic]
                [--dataset-source redteam|prod|compliance]
                [--dataset <frozen-dataset.json>]
                [--baseline <ref>]
                [--threshold <n>]
                [--signing-key <key>]
                [--report <path>]
  gatelane freeze-slice --window <7d|24h|30d> --output <path>
                [--endpoint <worker-url>] [--token <capture-token>]
  gatelane --help

v0.1.0 — real engine (replay → judge → compare → sign → evaluate).
`;

/**
 * Parsed CLI args.
 *
 * - `single` records a key → first value seen.
 * - `multi` records a key → every value seen in order (for repeated flags).
 *
 * Both are `Record<string, string | undefined>` rather than `Map` because keys
 * are static CLI flags known at author time, not runtime-inserted.
 */
type ParsedArgs = {
  positional: ReadonlyArray<string>;
  single: Record<string, string | boolean>;
  multi: Record<string, string[]>;
};

function parseArgs(argv: ReadonlyArray<string>): ParsedArgs {
  const positional: string[] = [];
  const single: Record<string, string | boolean> = {};
  const multi: Record<string, string[]> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      single[key] = true;
      continue;
    }
    const existing = multi[key];
    if (existing) {
      existing.push(next);
    } else {
      multi[key] = [next];
    }
    i++;
  }
  return { positional, single, multi };
}

/** Normalize a provider name from --provider / --judge-provider. */
function resolveProvider(s: string | undefined): string {
  return (s ?? 'mock').toLowerCase();
}

/**
 * Build an LLMCaller for the given provider.
 *
 * - `mock`      → deterministic in-process caller (no env needed)
 * - `openai`    → OpenAI Chat Completions; `OPENAI_BASE_URL` pins any
 *                 OpenAI-compatible endpoint (DeepSeek, Ollama, vLLM, OpenRouter…)
 * - `anthropic` → Anthropic Messages API
 *
 * Missing API key for a real provider is a hard error — a user who asked for
 * real calls must not silently get mock responses.
 */
function makeCaller(provider: string, defaultModel: string): LLMCaller {
  switch (provider) {
    case 'openai': {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new Error(
          '--provider openai requires OPENAI_API_KEY (add OPENAI_BASE_URL for OpenAI-compatible endpoints)',
        );
      }
      return new OpenAIChatCaller({
        apiKey,
        ...(process.env.OPENAI_BASE_URL !== undefined ? { baseURL: process.env.OPENAI_BASE_URL } : {}),
        defaultModel,
      });
    }
    case 'anthropic': {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        throw new Error('--provider anthropic requires ANTHROPIC_API_KEY');
      }
      return new AnthropicCaller({
        apiKey,
        ...(process.env.ANTHROPIC_BASE_URL !== undefined ? { baseURL: process.env.ANTHROPIC_BASE_URL } : {}),
        defaultModel,
      });
    }
    case 'mock':
      return new MockLLMCaller({ quality: 0.9 });
    default:
      throw new Error(`unknown provider: ${provider} (expected mock|openai|anthropic)`);
  }
}

/** Parse a time window like "7d"/"24h"/"30d" into a `since` ISO timestamp. */
function sinceFromWindow(window: string): string {
  const m = /^(\d+)([dh])$/.exec(window);
  if (!m) throw new Error(`invalid --window: ${window} (expected e.g. 7d, 24h, 30d)`);
  const n = Number(m[1]);
  const ms = m[2] === 'd' ? n * 24 * 60 * 60 * 1000 : n * 60 * 60 * 1000;
  return new Date(Date.now() - ms).toISOString();
}

async function cmdGate(argv: ReadonlyArray<string>): Promise<number> {
  const { multi } = parseArgs(argv);
  const candidates = multi['candidate'] ?? [];
  const judges = (multi['judges']?.[0] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const datasetSource = (multi['dataset-source']?.[0] ?? 'redteam') as DatasetSourceKind;
  const datasetPath = multi['dataset']?.[0];
  const baseline = multi['baseline']?.[0];
  const threshold = Number(multi['threshold']?.[0] ?? '0.02');
  const reportPath = multi['report']?.[0];
  const provider = resolveProvider(multi['provider']?.[0]);
  const judgeProvider = resolveProvider(multi['judge-provider']?.[0] ?? multi['provider']?.[0]);
  const signingKey =
    multi['signing-key']?.[0] ??
    process.env.GATELANE_SIGNING_KEY ??
    'dev-only-insecure-signing-key';

  if (candidates.length === 0 || judges.length === 0) {
    process.stderr.write('error: --candidate and --judges are required\n');
    return 2;
  }
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    process.stderr.write(`error: --threshold must be 0..1, got ${threshold}\n`);
    return 2;
  }

  let dataset: FrozenDataset;
  if (datasetPath !== undefined) {
    dataset = JSON.parse(await readFile(datasetPath, 'utf-8')) as FrozenDataset;
  } else if (datasetSource === 'redteam') {
    dataset = await freezeInjectionDataset();
  } else {
    dataset = await freezeDataset({
      source_kind: datasetSource,
      source_ref: `${datasetSource}-stub@v0.1.0`,
      items: [],
    });
  }

  // Candidate caller drives the replay; per-judge callers drive judging.
  const candidateCaller = makeCaller(provider, candidates[0]?.replace(/^model:/, '') ?? '');
  const judgeCallers: Record<string, LLMCaller> = {};
  for (const judgeRef of judges) {
    judgeCallers[judgeRef] = makeCaller(judgeProvider, judgeRef);
  }

  const runner = createRunner({
    caller: candidateCaller,
    judge_callers: judgeCallers,
    signing_key: signingKey,
    messages_from_item: (item) => {
      const input = item.input;
      if (Array.isArray(input)) {
        return input
          .filter(
            (m): m is { role: string; content: string } =>
              typeof m === 'object' && m !== null && 'role' in m && 'content' in m,
          )
          .map((m) => ({ role: m.role as 'system' | 'user' | 'assistant', content: m.content }));
      }
      return [{ role: 'user', content: String(input ?? '') }];
    },
  });
  const { setGateRunner, runGate, resetGateRunner } = await import('@lanefoundry/gatelane-sdk/gate');
  setGateRunner(runner);
  try {
    const result = await runGate({
      candidates,
      dataset,
      judges,
      ...(baseline !== undefined ? { baseline } : {}),
      policy: {
        min_delta: threshold,
        judge_stability_threshold: 0.67,
        cost_ceiling: 0.1,
        latency_ceiling: 0.2,
        approval_required: false,
      },
    });
    const summary = {
      gate_run_id: result.report.gate_run_id,
      report_id: result.report.id,
      decision: result.decision,
      candidate_shas: result.report.candidate_shas,
      judge_shas: result.report.judge_shas,
      signature: result.report.signature,
      timestamp: result.report.timestamp,
    };
    const json = JSON.stringify(summary, null, 2);
    if (reportPath !== undefined) {
      await writeFile(reportPath, json, 'utf-8');
      process.stdout.write(`report written to ${reportPath}\n`);
    } else {
      process.stdout.write(json + '\n');
    }
    return 0;
  } finally {
    resetGateRunner();
  }
}

async function cmdFreezeSlice(argv: ReadonlyArray<string>): Promise<number> {
  const { multi } = parseArgs(argv);
  const window = multi['window']?.[0] ?? '7d';
  const output = multi['output']?.[0];
  const endpoint = multi['endpoint']?.[0] ?? process.env.GATELANE_ENDPOINT;
  const token = multi['token']?.[0] ?? process.env.GATELANE_CAPTURE_TOKEN;

  if (!output) {
    process.stderr.write('error: --output is required\n');
    return 2;
  }
  if (!endpoint || !token) {
    process.stderr.write(
      'error: freeze-slice needs a Worker endpoint. Pass --endpoint <url> --token <capture-token>\n' +
        '       or set GATELANE_ENDPOINT / GATELANE_CAPTURE_TOKEN env.\n',
    );
    return 2;
  }

  const since = sinceFromWindow(window);
  const storage = new HttpStorage({ endpoint, token });
  const captures = await storage.list({ since, limit: 1000 });

  // One user prompt → one dataset item. Multi-message prompts serialize as-is.
  const items = captures.map((c) => ({
    id: c.id,
    input: c.input.prompt.length === 1
      ? c.input.prompt[0].content
      : c.input.prompt.map((m) => ({ role: m.role, content: m.content })),
  }));
  const dataset = await freezeDataset({
    source_kind: 'prod',
    source_ref: `prod-slice-${window}@v0.1.0`,
    slice_filter: { window, since },
    items,
  });
  await writeFile(output, JSON.stringify(dataset, null, 2), 'utf-8');
  process.stdout.write(`frozen dataset (${dataset.item_count} items) → ${output}\n`);
  return 0;
}

async function main(argv: ReadonlyArray<string>): Promise<number> {
  const command = argv[0];
  if (command === undefined || command === '--help' || command === '-h') {
    process.stdout.write(HELP);
    return 0;
  }
  if (command === 'gate') return cmdGate(argv.slice(1));
  if (command === 'freeze-slice') return cmdFreezeSlice(argv.slice(1));
  process.stderr.write(`unknown command: ${command}\n`);
  return 2;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  },
);