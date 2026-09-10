#!/usr/bin/env node
/**
 * gatelane CLI — promotion gate for AI agents.
 *
 * Commands:
 *   gatelane gate      — replay → judge → compare → sign → evaluate
 *   gatelane attack    — red team attack against a live agent endpoint
 *   gatelane freeze-slice — freeze a production traffic slice for backtest
 *   gatelane capture   — record a single LLM call to local storage
 *
 * @see docs/distribution.md
 */
import { readFile, writeFile } from 'node:fs/promises';

import {
  capture,
  freezeDataset,
  setStorage,
  FilesystemStorage,
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
  gatelane attack <url> [options]          Attack a live agent endpoint
    --request-template <json>              Request body template, use {{payload}} as placeholder
                                           e.g. '{"query": "{{payload}}", "limit": 5}'
    --header <key:value>                   HTTP header (repeatable)
    --categories <list>                    Comma-separated attack categories to run
    --concurrency <n>                      Max parallel requests (default: 5)
    --report <path>                        Write JSON report to file

  gatelane gate [options]                  Run promotion gate
    --candidate <ref>                      Candidate to evaluate (repeatable)
    --judges <list>                        Comma-separated judge models
    --provider mock|openai|anthropic       LLM provider for candidate replay
    --judge-provider mock|openai|anthropic LLM provider for judging
    --dataset-source redteam|prod|compliance
    --dataset <path>                       Frozen dataset JSON file
    --baseline <ref>                       Baseline reference
    --threshold <n>                        Min delta for promotion (0..1, default 0.02)
    --report <path>                        Write JSON report to file

  gatelane capture <json>                  Record a single LLM call
    --dir <path>                           Storage directory (default: .gatelane/captures)

  gatelane freeze-slice [options]          Freeze production traffic slice
    --window <7d|24h|30d>                  Time window
    --output <path>                        Output file path
    --endpoint <url>                       Worker endpoint URL
    --token <token>                        Capture API token

  gatelane --help

Env:
  OPENAI_API_KEY / OPENAI_BASE_URL        (provider=openai)
  ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL   (provider=anthropic)
  GATELANE_ENDPOINT / GATELANE_CAPTURE_TOKEN (freeze-slice / capture defaults)

v0.1.0
`;

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

function resolveProvider(s: string | undefined): string {
  return (s ?? 'mock').toLowerCase();
}

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

function sinceFromWindow(window: string): string {
  const m = /^(\d+)([dh])$/.exec(window);
  if (!m) throw new Error(`invalid --window: ${window} (expected e.g. 7d, 24h, 30d)`);
  const n = Number(m[1]);
  const ms = m[2] === 'd' ? n * 24 * 60 * 60 * 1000 : n * 60 * 60 * 1000;
  return new Date(Date.now() - ms).toISOString();
}

// ─── attack ───────────────────────────────────────────────────────────────────

async function cmdAttack(argv: ReadonlyArray<string>): Promise<number> {
  const { positional, multi } = parseArgs(argv);
  const url = positional[0];

  if (!url) {
    process.stderr.write('error: attack requires a target URL\n');
    process.stderr.write('usage: gatelane attack <url> [--request-template <json>] [--header <k:v>] [--report <path>]\n');
    return 2;
  }

  const { allVectors, runAttackBatch, generateReport } = await import('@gatelane/mode-red-team');

  const templateStr = multi['request-template']?.[0];
  const headerEntries = multi['header'] ?? [];
  const categoriesStr = multi['categories']?.[0];
  const concurrency = Number(multi['concurrency']?.[0] ?? '5');
  const reportPath = multi['report']?.[0];

  const headers: Record<string, string> = {};
  for (const h of headerEntries) {
    const colonIdx = h.indexOf(':');
    if (colonIdx === -1) {
      process.stderr.write(`error: invalid header format "${h}", expected "Key: Value"\n`);
      return 2;
    }
    headers[h.slice(0, colonIdx).trim()] = h.slice(colonIdx + 1).trim();
  }

  const buildRequest = templateStr
    ? (payload: string) => {
        const escaped = JSON.stringify(payload).slice(1, -1);
        return JSON.parse(templateStr.replace(/\{\{payload\}\}/g, escaped));
      }
    : undefined;

  let vectors = allVectors;
  if (categoriesStr) {
    const cats = new Set(categoriesStr.split(',').map((s) => s.trim()));
    vectors = vectors.filter((v) => cats.has(v.category));
  }

  process.stdout.write(`attacking ${url} with ${vectors.length} vectors (concurrency=${concurrency})...\n`);

  const target = { url, name: new URL(url).hostname };
  const results = await runAttackBatch(vectors, target, {
    headers,
    buildRequest,
    concurrency,
  });

  const report = generateReport(results, [url]);

  const succeeded = report.successfulAttacks;
  const total = report.totalAttacks;
  const blocked = total - succeeded;
  process.stdout.write(`\n── results ──\n`);
  process.stdout.write(`total: ${total}  |  blocked: ${blocked}  |  bypassed: ${succeeded}\n`);

  if (succeeded > 0) {
    process.stdout.write(`\nvulnerabilities found:\n`);
    for (const r of results.filter((r) => r.success)) {
      process.stdout.write(`  [${r.vectorId}] ${r.payload.slice(0, 80)}...\n`);
      process.stdout.write(`    response: ${r.agentResponse.slice(0, 120)}...\n`);
      process.stdout.write(`    patch: ${r.patchRecommendation}\n\n`);
    }
  }

  if (reportPath) {
    await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf-8');
    process.stdout.write(`report written to ${reportPath}\n`);
  }

  return succeeded > 0 ? 1 : 0;
}

// ─── capture ──────────────────────────────────────────────────────────────────

async function cmdCapture(argv: ReadonlyArray<string>): Promise<number> {
  const { positional, multi } = parseArgs(argv);
  const jsonStr = positional[0];
  const dir = multi['dir']?.[0] ?? '.gatelane/captures';

  if (!jsonStr) {
    process.stderr.write('error: capture requires a JSON argument\n');
    process.stderr.write('usage: gatelane capture \'{"prompt":[...],"model":"...","response":"..."}\' [--dir <path>]\n');
    return 2;
  }

  let data: { prompt: { role: string; content: string }[]; model?: string; response?: unknown; metadata?: Record<string, unknown> };
  try {
    data = JSON.parse(jsonStr);
  } catch {
    process.stderr.write('error: invalid JSON\n');
    return 2;
  }

  setStorage(new FilesystemStorage({ dir }));

  const result = await capture(
    {
      prompt: data.prompt,
      model: data.model,
      metadata: data.metadata,
    },
    async () => data.response ?? null,
  );

  process.stdout.write(`captured to ${dir} (response: ${JSON.stringify(result).slice(0, 100)})\n`);
  return 0;
}

// ─── gate ─────────────────────────────────────────────────────────────────────

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

// ─── freeze-slice ─────────────────────────────────────────────────────────────

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

// ─── main ─────────────────────────────────────────────────────────────────────

async function main(argv: ReadonlyArray<string>): Promise<number> {
  const command = argv[0];
  if (command === undefined || command === '--help' || command === '-h') {
    process.stdout.write(HELP);
    return 0;
  }
  if (command === 'attack') return cmdAttack(argv.slice(1));
  if (command === 'gate') return cmdGate(argv.slice(1));
  if (command === 'capture') return cmdCapture(argv.slice(1));
  if (command === 'freeze-slice') return cmdFreezeSlice(argv.slice(1));
  process.stderr.write(`unknown command: ${command}\nrun "gatelane --help" for usage.\n`);
  return 2;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  },
);
