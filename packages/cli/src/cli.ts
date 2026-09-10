#!/usr/bin/env node
/**
 * gatelane CLI — promotion gate for AI agents.
 *
 * Commands:
 *   gatelane eval      — run tests + red team from a YAML config, judge + store
 *   gatelane gate      — replay → judge → compare → sign → evaluate
 *   gatelane attack    — red team attack against a live agent endpoint
 *   gatelane traces    — list and inspect collected traces
 *   gatelane compare   — diff two trace sets (before vs after)
 *   gatelane rerun     — re-run traces against a new endpoint, then compare
 *   gatelane freeze-slice — freeze a production traffic slice for backtest
 *   gatelane capture   — record a single LLM call to local storage
 *
 * @see docs/distribution.md
 */
import { readFile, writeFile } from 'node:fs/promises';
import * as yaml from 'js-yaml';

import {
  capture,
  freezeDataset,
  setStorage,
  FilesystemStorage,
  HttpStorage,
  FilesystemTraceStore,
  GatelaneTrace,
  GatelaneTracer,
  compareTraces,
  parseEvalConfig,
  runEval,
  type DatasetSourceKind,
  type FrozenDataset,
  type RedteamRunner,
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
  gatelane eval [options]                  Run tests + red team from YAML config
    --config <path>                        Config file (default: gatelane.yaml)
    --tag <tag>                            Tag for this eval run (required)
    --dir <path>                           Trace directory (default: .gatelane/traces)
    --concurrency <n>                      Max parallel requests (default: 5)
    --report <path>                        Write JSON report to file

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

  gatelane traces [options]                List collected traces
    --dir <path>                           Trace directory (default: .gatelane/traces)
    --limit <n>                            Max traces to show (default: 20)
    --tag <tag>                            Filter by tag
    --id <traceId>                         Show one trace in detail

  gatelane compare [options]               Diff two trace sets (before vs after)
    --dir <path>                           Trace directory (default: .gatelane/traces)
    --baseline <tag>                       Baseline tag (e.g. "v1")
    --candidate <tag>                      Candidate tag (e.g. "v2")
    --report <path>                        Write JSON report to file

  gatelane rerun [options]                  Re-run traces against new endpoint, then compare
    --dir <path>                           Trace directory (default: .gatelane/traces)
    --source-tag <tag>                     Tag of traces to replay (required)
    --new-tag <tag>                        Tag for new traces (required)
    --endpoint <url>                       Agent endpoint to replay against (required)
    --request-template <json>              Request body template, use {{input}} as placeholder
    --header <key:value>                   HTTP header (repeatable)
    --concurrency <n>                      Max parallel requests (default: 3)
    --report <path>                        Write comparison JSON report to file

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

// ─── eval ─────────────────────────────────────────────────────────────────────

async function cmdEval(argv: ReadonlyArray<string>): Promise<number> {
  const { multi } = parseArgs(argv);
  const configPath = multi['config']?.[0] ?? 'gatelane.yaml';
  const tag = multi['tag']?.[0];
  const traceDir = multi['dir']?.[0] ?? '.gatelane/traces';
  const concurrency = Number(multi['concurrency']?.[0] ?? '5');
  const reportPath = multi['report']?.[0];

  if (!tag) {
    process.stderr.write('error: --tag is required\n');
    process.stderr.write('usage: gatelane eval --tag v1 [--config gatelane.yaml]\n');
    return 2;
  }

  let configText: string;
  try {
    configText = await readFile(configPath, 'utf-8');
  } catch {
    process.stderr.write(`error: cannot read config file "${configPath}"\n`);
    process.stderr.write('create one from gatelane.example.yaml or pass --config <path>\n');
    return 2;
  }

  const raw = yaml.load(configText);
  const config = parseEvalConfig(raw);

  // Build redteam runner using mode-red-team
  const redteamRunner: RedteamRunner | undefined = config.redteam
    ? async (url, categories, headers, buildRequest) => {
        const { allVectors, runAttackBatch } = await import('@gatelane/mode-red-team');
        let vectors = allVectors;
        if (categories && categories.length > 0) {
          const cats = new Set(categories);
          vectors = vectors.filter((v) => cats.has(v.category));
        }
        const results = await runAttackBatch(
          vectors,
          { url, name: new URL(url).hostname },
          { headers, buildRequest, concurrency },
        );
        const blocked = results.filter((r) => !r.success).length;
        return {
          total: results.length,
          blocked,
          bypassed: results.length - blocked,
          results: results.map((r) => ({
            vectorId: r.vectorId,
            category: r.vectorId.split('-').slice(0, -1).join('-'),
            success: r.success,
            payload: r.payload,
          })),
        };
      }
    : undefined;

  process.stdout.write(`\n── gatelane eval (tag: ${tag}) ──\n`);
  process.stdout.write(`config: ${configPath}\n`);
  process.stdout.write(`target: ${config.target.url}\n\n`);

  const result = await runEval(config, {
    tag,
    traceDir,
    concurrency,
    redteamRunner,
    onProgress: (done, total, label) => {
      process.stdout.write(`  [${done}/${total}] ${label}\r`);
    },
  });

  // Print test results
  const { summary } = result;
  process.stdout.write(`\ntests: ${summary.passedTests} passed, ${summary.failedTests} failed, ${summary.totalTests} total\n`);
  if (summary.avgJudgeScore > 0) {
    process.stdout.write(`  avg judge score: ${summary.avgJudgeScore.toFixed(2)}\n`);
  }
  process.stdout.write(`  avg latency: ${summary.avgLatencyMs.toFixed(0)}ms\n`);

  // Print red team results
  if (result.redteam.total > 0) {
    const blockPct = (summary.redteamBlockRate * 100).toFixed(0);
    process.stdout.write(`\nred team: ${result.redteam.blocked} blocked, ${result.redteam.bypassed} bypassed, ${result.redteam.total} total\n`);
    process.stdout.write(`  block rate: ${blockPct}%\n`);

    const bypassed = result.redteam.results.filter((r) => r.success);
    if (bypassed.length > 0) {
      process.stdout.write(`\n  bypassed:\n`);
      for (const r of bypassed) {
        process.stdout.write(`    [${r.vectorId}] ${r.payload.slice(0, 70)}...\n`);
      }
    }
  }

  // Print failed tests
  const failed = result.tests.filter((t) => !t.passed);
  if (failed.length > 0) {
    process.stdout.write(`\nfailed tests:\n`);
    for (const t of failed) {
      process.stdout.write(`  "${t.input.slice(0, 60)}"\n`);
      for (const a of t.assertions.filter((a) => !a.passed)) {
        process.stdout.write(`    ✗ ${a.type}: "${a.expected}" (actual: ${a.actual})\n`);
      }
    }
  }

  // Print blue team results
  if (result.blueteam && (result.blueteam.blockResponseChecks.length > 0 || result.blueteam.leakChecks.length > 0 || result.blueteam.falsePositives.length > 0)) {
    process.stdout.write(`\nblue team:\n`);

    const failedBlockChecks = result.blueteam.blockResponseChecks.filter((c) => !c.passed);
    if (failedBlockChecks.length > 0) {
      process.stdout.write(`  block response quality: ${failedBlockChecks.length} failed\n`);
      for (const c of failedBlockChecks) {
        process.stdout.write(`    ✗ ${c.assertion} — ${c.detail}\n`);
      }
    } else if (result.blueteam.blockResponseChecks.length > 0) {
      process.stdout.write(`  block response quality: all passed\n`);
    }

    if (result.blueteam.leakChecks.length > 0) {
      process.stdout.write(`  info leakage: ${result.blueteam.leakChecks.length} found\n`);
      for (const l of result.blueteam.leakChecks) {
        process.stdout.write(`    ✗ leaked "${l.pattern}" in: "${l.inResponse}"\n`);
      }
    } else {
      process.stdout.write(`  info leakage: none detected\n`);
    }

    const failedFP = result.blueteam.falsePositives.filter((f) => !f.passed);
    if (failedFP.length > 0) {
      process.stdout.write(`  false positives: ${failedFP.length} misblocked\n`);
      for (const f of failedFP) {
        process.stdout.write(`    ✗ "${f.input}" — ${f.detail}\n`);
      }
    } else if (result.blueteam.falsePositives.length > 0) {
      process.stdout.write(`  false positives: none (all normal queries passed)\n`);
    }
  }

  process.stdout.write(`\ntraces saved to ${traceDir} with tag [${tag}]\n`);

  // Write report
  if (reportPath) {
    await writeFile(reportPath, JSON.stringify(result, null, 2), 'utf-8');
    process.stdout.write(`report written to ${reportPath}\n`);
  }

  const allPassed = summary.failedTests === 0 && summary.redteamBlockRate === 1 && summary.blueteamPassed;
  return allPassed ? 0 : 1;
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

// ─── traces ───────────────────────────────────────────────────────────────────

async function cmdTraces(argv: ReadonlyArray<string>): Promise<number> {
  const { multi } = parseArgs(argv);
  const dir = multi['dir']?.[0] ?? '.gatelane/traces';
  const limit = Number(multi['limit']?.[0] ?? '20');
  const tag = multi['tag']?.[0];
  const traceId = multi['id']?.[0];

  const store = new FilesystemTraceStore(dir);

  if (traceId) {
    const trace = await store.read(traceId);
    if (!trace) {
      process.stderr.write(`trace not found: ${traceId}\n`);
      return 1;
    }
    process.stdout.write(JSON.stringify(trace, null, 2) + '\n');
    return 0;
  }

  const traces = await store.list({
    limit,
    ...(tag ? { tags: [tag] } : {}),
  });

  if (traces.length === 0) {
    process.stdout.write(`no traces found in ${dir}\n`);
    return 0;
  }

  process.stdout.write(`${traces.length} trace(s) in ${dir}:\n\n`);
  for (const t of traces) {
    const latency = t.endTime
      ? `${new Date(t.endTime).getTime() - new Date(t.startTime).getTime()}ms`
      : 'pending';
    const spans = t.spans.length;
    const gens = t.spans.reduce((sum, s) => sum + s.generations.length, 0);
    const scores = t.scores
      ? Object.entries(t.scores).map(([k, v]) => `${k}=${v.toFixed(2)}`).join(' ')
      : '';
    const tags = t.tags?.length ? ` [${t.tags.join(', ')}]` : '';
    process.stdout.write(
      `  ${t.id.slice(0, 8)}  ${t.startTime.slice(0, 19)}  ${t.name}  ${spans}span ${gens}gen  ${latency}${tags}${scores ? '  ' + scores : ''}\n`,
    );
  }
  return 0;
}

// ─── compare ──────────────────────────────────────────────────────────────────

async function cmdCompare(argv: ReadonlyArray<string>): Promise<number> {
  const { multi } = parseArgs(argv);
  const dir = multi['dir']?.[0] ?? '.gatelane/traces';
  const baselineTag = multi['baseline']?.[0];
  const candidateTag = multi['candidate']?.[0];
  const reportPath = multi['report']?.[0];

  if (!baselineTag || !candidateTag) {
    process.stderr.write('error: --baseline and --candidate tags are required\n');
    process.stderr.write('usage: gatelane compare --baseline v1 --candidate v2\n');
    return 2;
  }

  const store = new FilesystemTraceStore(dir);
  const baselineTraces = await store.list({ tags: [baselineTag] });
  const candidateTraces = await store.list({ tags: [candidateTag] });

  if (baselineTraces.length === 0) {
    process.stderr.write(`no traces found with tag "${baselineTag}"\n`);
    return 1;
  }
  if (candidateTraces.length === 0) {
    process.stderr.write(`no traces found with tag "${candidateTag}"\n`);
    return 1;
  }

  const report = compareTraces(baselineTraces, candidateTraces, {
    baselineTag,
    candidateTag,
  });

  process.stdout.write(`\n── comparison: ${baselineTag} vs ${candidateTag} ──\n`);
  process.stdout.write(`matched pairs: ${report.totalPairs}\n`);
  process.stdout.write(`  improvements: ${report.improvements}\n`);
  process.stdout.write(`  regressions:  ${report.regressions}\n`);
  process.stdout.write(`  unchanged:    ${report.unchanged}\n`);
  process.stdout.write(`  avg latency Δ: ${report.summary.avgLatencyDelta.toFixed(0)}ms\n`);

  for (const [name, delta] of Object.entries(report.summary.avgScoreDelta)) {
    process.stdout.write(`  avg ${name} Δ: ${delta > 0 ? '+' : ''}${delta.toFixed(3)}\n`);
  }

  if (report.regressions > 0) {
    process.stdout.write(`\nregressions:\n`);
    for (const pair of report.pairs.filter((p) => p.regressions.length > 0)) {
      const inputStr = typeof pair.input === 'string' ? pair.input : JSON.stringify(pair.input);
      process.stdout.write(`  "${inputStr.slice(0, 60)}..."\n`);
      for (const r of pair.regressions) {
        process.stdout.write(`    ↓ ${r}\n`);
      }
    }
  }

  if (reportPath) {
    await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf-8');
    process.stdout.write(`\nreport written to ${reportPath}\n`);
  }

  return report.regressions > 0 ? 1 : 0;
}

// ─── rerun ────────────────────────────────────────────────────────────────────

async function cmdRerun(argv: ReadonlyArray<string>): Promise<number> {
  const { multi } = parseArgs(argv);
  const dir = multi['dir']?.[0] ?? '.gatelane/traces';
  const sourceTag = multi['source-tag']?.[0];
  const newTag = multi['new-tag']?.[0];
  const endpoint = multi['endpoint']?.[0];
  const templateStr = multi['request-template']?.[0];
  const headerEntries = multi['header'] ?? [];
  const concurrency = Number(multi['concurrency']?.[0] ?? '3');
  const reportPath = multi['report']?.[0];

  if (!sourceTag || !newTag || !endpoint) {
    process.stderr.write('error: --source-tag, --new-tag, and --endpoint are required\n');
    process.stderr.write('usage: gatelane rerun --source-tag v1 --new-tag v2 --endpoint <url> [--request-template <json>]\n');
    return 2;
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  for (const h of headerEntries) {
    const colonIdx = h.indexOf(':');
    if (colonIdx === -1) {
      process.stderr.write(`error: invalid header format "${h}", expected "Key: Value"\n`);
      return 2;
    }
    headers[h.slice(0, colonIdx).trim()] = h.slice(colonIdx + 1).trim();
  }

  const store = new FilesystemTraceStore(dir);
  const sourceTraces = await store.list({ tags: [sourceTag] });

  if (sourceTraces.length === 0) {
    process.stderr.write(`no traces found with tag "${sourceTag}" in ${dir}\n`);
    return 1;
  }

  process.stdout.write(`replaying ${sourceTraces.length} traces from [${sourceTag}] → [${newTag}] against ${endpoint}\n`);

  const tracer = new GatelaneTracer(store);
  const newTraces: GatelaneTrace[] = [];
  let completed = 0;

  // Build a queue for concurrency-limited execution
  const queue = [...sourceTraces];
  async function worker(): Promise<void> {
    while (queue.length > 0) {
      const src = queue.shift();
      if (!src) break;

      const inputStr = typeof src.input === 'string' ? src.input : JSON.stringify(src.input);
      let body: unknown;
      if (templateStr) {
        const escaped = JSON.stringify(inputStr).slice(1, -1);
        body = JSON.parse(templateStr.replace(/\{\{input\}\}/g, escaped));
      } else {
        body = { messages: [{ role: 'user', content: inputStr }] };
      }

      const trace = tracer.trace({
        name: src.name,
        input: src.input,
        userId: src.userId,
        tags: [newTag],
        metadata: { rerunFrom: src.id, endpoint, ...(src.metadata ?? {}) },
      });

      const span = trace.span({ name: 'rerun-call' });
      const start = Date.now();
      let responseText = '';
      let httpStatus = 0;

      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        });
        httpStatus = res.status;
        responseText = await res.text();
      } catch (err) {
        responseText = `[error] ${err instanceof Error ? err.message : String(err)}`;
      }

      const latencyMs = Date.now() - start;

      span.generation({
        name: 'agent-response',
        model: 'agent',
        input: body,
        output: responseText.slice(0, 5000),
        metadata: { httpStatus, latencyMs },
      });
      span.end({ output: { response: responseText.slice(0, 2000), httpStatus } });

      // Carry over source scores so compare can diff (candidate will keep these as-is;
      // a real judge pass would overwrite them, but that's out of scope for rerun).
      if (src.scores) {
        for (const [k, v] of Object.entries(src.scores)) {
          trace.score(k, v);
        }
      }

      trace.end(responseText.slice(0, 2000));
      tracer.enqueue(trace);
      newTraces.push(trace);

      completed++;
      process.stdout.write(`  replaying ${completed}/${sourceTraces.length}...\r`);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, sourceTraces.length) }, () => worker()),
  );
  await tracer.flush();

  process.stdout.write(`\n${completed} traces replayed and saved with tag [${newTag}]\n`);

  // Auto-compare
  const candidateTraces = newTraces.map((t) => t.toJSON());
  const report = compareTraces(sourceTraces, candidateTraces, {
    baselineTag: sourceTag,
    candidateTag: newTag,
  });

  process.stdout.write(`\n── comparison: ${sourceTag} vs ${newTag} ──\n`);
  process.stdout.write(`matched pairs: ${report.totalPairs}\n`);
  process.stdout.write(`  improvements: ${report.improvements}\n`);
  process.stdout.write(`  regressions:  ${report.regressions}\n`);
  process.stdout.write(`  unchanged:    ${report.unchanged}\n`);
  process.stdout.write(`  avg latency Δ: ${report.summary.avgLatencyDelta.toFixed(0)}ms\n`);

  for (const [name, delta] of Object.entries(report.summary.avgScoreDelta)) {
    process.stdout.write(`  avg ${name} Δ: ${delta > 0 ? '+' : ''}${delta.toFixed(3)}\n`);
  }

  if (report.regressions > 0) {
    process.stdout.write(`\nregressions:\n`);
    for (const pair of report.pairs.filter((p) => p.regressions.length > 0)) {
      const inputDisplay = typeof pair.input === 'string' ? pair.input : JSON.stringify(pair.input);
      process.stdout.write(`  "${inputDisplay.slice(0, 60)}..."\n`);
      for (const r of pair.regressions) {
        process.stdout.write(`    ↓ ${r}\n`);
      }
    }
  }

  if (reportPath) {
    await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf-8');
    process.stdout.write(`\nreport written to ${reportPath}\n`);
  }

  return report.regressions > 0 ? 1 : 0;
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
  if (command === 'eval') return cmdEval(argv.slice(1));
  if (command === 'attack') return cmdAttack(argv.slice(1));
  if (command === 'gate') return cmdGate(argv.slice(1));
  if (command === 'traces') return cmdTraces(argv.slice(1));
  if (command === 'compare') return cmdCompare(argv.slice(1));
  if (command === 'rerun') return cmdRerun(argv.slice(1));
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
