#!/usr/bin/env node
/**
 * gatelane CLI — promotion gate for AI agents.
 *
 * Config-first: put a gatelane.config.yaml in your project root,
 * then just `npx gatelane eval`. CLI flags override config values.
 *
 * @see docs/distribution.md
 */
import { config as loadDotenv } from 'dotenv';
import { readFile, writeFile, access, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

import {
  freezeDataset,
  HttpStorage,
  type DatasetSourceKind,
  type FrozenDataset,
} from '@lanefoundry/gatelane-sdk';

import {
  startCanary,
  recordObservation,
  advanceCanary,
  rollbackCanary,
  tickCanaries,
  getActiveCanaries,
  getCanaryStorage,
  InMemoryCanaryStorage,
  setCanaryStorage,
  type CanaryRecord,
} from '@lanefoundry/source-prod-slice';

import { freezeInjectionDataset } from '@lanefoundry/gatelane-engine/attack';
import {
  createRunner,
  MockLLMCaller,
  OpenAIChatCaller,
  AnthropicCaller,
  GoogleCaller,
  parseProviderModel,
  PROVIDER_REGISTRY,
  PROVIDER_PRICING,
  runRedTeamGate,
  verifyPatchHolds,
  type LLMCaller,
  type AttackReport,
  type ScanReplayRow,
  exportTurnsToOTel,
  type OTelExportConfig,
} from '@lanefoundry/gatelane-engine';

const SUPPORTED_PROVIDERS = ['mock', ...Object.keys(PROVIDER_REGISTRY)].join('|');

const HELP = `gatelane — promotion gate for AI agents

Usage:
  gatelane scan [options]             Security scan (attack probes)
  gatelane eval [options]             Quality evaluation (backtest promotion gate)
  gatelane run [options]              Full pipeline (scan + eval)
  gatelane snapshot [options]         Snapshot production traffic into a dataset
  gatelane canary <subcommand>       Canary deployment management
  gatelane init                       Create a starter gatelane.config.yaml
  gatelane --help

Config file (gatelane.config.yaml):
  candidates:
    - groq:llama-3.1-70b-versatile
    - openai:gpt-4o
    - google:gemini-2.5-flash
  judges:
    - anthropic:claude-3-5-sonnet
  dataset: my-dataset.json
  threshold: 0.02

  Put API keys in .env (auto-loaded). CLI flags override config values.

Scan options:
  --candidate <ref>       Candidate to scan (provider:model format)
  --judges <list>         Comma-separated judge models
  --baseline <ref>        Compare patched vs baseline (patch verification)
  --provider <name>       Default provider for candidates without prefix
  --judge-provider <name> Default provider for judges
  --report <path>         Write report JSON to file
  --format <fmt>          Output format: table (default) | json
  --config <path>         Config file path (default: gatelane.config.yaml)
  --env-file <path>       Env file path (default: .env)

Eval options:
  --candidate <ref>       Add candidate (provider:model format)
  --judges <list>         Comma-separated judge models
  --dataset <path>        Frozen dataset JSON file
  --dataset-source <src>  redteam|prod|compliance (default: redteam)
  --provider <name>       Default provider for candidates without prefix
  --judge-provider <name> Default provider for judges
  --threshold <n>         Min delta for promotion (default: 0.02)
  --baseline <ref>        Baseline candidate ref
  --report <path>         Write report JSON to file
  --format <fmt>          Output format: json (default) | table
  --dry-run               Show what would run without calling APIs
  --config <path>         Config file path (default: gatelane.config.yaml)
  --env-file <path>       Env file path (default: .env)

Snapshot options:
  --window <7d|24h|30d>   Time window (default: 7d)
  --output <path>         Output dataset file (required)
  --endpoint <url>        Worker endpoint URL
  --token <token>         Capture API token

Canary subcommands:
  gatelane canary start --report <path>                   Start canary from report JSON
  gatelane canary status [--id <id>]                      Show canary status or list all
  gatelane canary observe --id <id> --metric <n> --value <n> --baseline <n>
  gatelane canary advance --id <id>                       Advance canary state machine
  gatelane canary rollback --id <id> --reason <text>      Manual rollback
  gatelane canary tick                                    Advance all eligible canaries

Providers: ${SUPPORTED_PROVIDERS}

v0.5.0 — scan + eval + run + canary + CI/CD adapter.
`;

// ── Config schema (zod) ──────────────────────────────────────────────

const VALID_PROVIDERS = new Set(['mock', ...Object.keys(PROVIDER_REGISTRY)]);

const configSchema = z.object({
  candidates: z.array(z.string()).optional(),
  judges: z.array(z.string()).optional(),
  dataset: z.string().optional(),
  dataset_source: z.enum(['redteam', 'prod', 'compliance']).optional(),
  provider: z.string().optional(),
  judge_provider: z.string().optional(),
  threshold: z.number().min(0).max(1).optional(),
  baseline: z.string().optional(),
  report: z.string().optional(),
  signing_key: z.string().optional(),
  format: z.enum(['json', 'table']).optional(),
  export: z.object({
    otlp_endpoint: z.string(),
    otlp_headers: z.record(z.string(), z.string()).optional(),
    service_name: z.string().optional(),
  }).optional(),
}).strict();

type GatelaneConfig = z.infer<typeof configSchema>;

// ── Config file loading ──────────────────────────────────────────────

const CONFIG_FILES = [
  'gatelane.config.yaml',
  'gatelane.config.yml',
  'gatelane.config.json',
];

async function loadConfig(explicitPath?: string): Promise<GatelaneConfig> {
  let raw: string;
  let filePath: string;

  if (explicitPath) {
    filePath = resolve(explicitPath);
    raw = await readFile(filePath, 'utf-8');
  } else {
    let found = false;
    filePath = '';
    raw = '';
    for (const name of CONFIG_FILES) {
      const p = resolve(name);
      try {
        await access(p);
      } catch {
        continue;
      }
      filePath = p;
      raw = await readFile(p, 'utf-8');
      process.stderr.write(`  config: ${name}\n`);
      found = true;
      break;
    }
    if (!found) return {};
  }

  const parsed = filePath.endsWith('.json')
    ? JSON.parse(raw) as unknown
    : parseYaml(raw) as unknown;

  if (parsed === null || parsed === undefined) return {};

  const result = configSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => {
      if (issue.code === 'unrecognized_keys') {
        const keys = (issue as { keys: string[] }).keys;
        return `  unknown field: "${keys.join('", "')}" — check for typos`;
      }
      return `  ${issue.path.join('.')}: ${issue.message}`;
    });
    process.stderr.write(`config error in ${filePath}:\n${issues.join('\n')}\n`);
    process.exit(2);
  }

  for (const ref of result.data.candidates ?? []) {
    const { provider } = parseProviderModel(ref, 'mock');
    if (!VALID_PROVIDERS.has(provider)) {
      process.stderr.write(`config error: unknown provider "${provider}" in candidate "${ref}"\n`);
      process.stderr.write(`  valid providers: ${SUPPORTED_PROVIDERS}\n`);
      process.exit(2);
    }
  }

  return result.data;
}

// ── Arg parser ───────────────────────────────────────────────────────

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

// ── Provider factory ─────────────────────────────────────────────────

function makeCaller(provider: string, defaultModel: string): LLMCaller {
  if (provider === 'mock') {
    return new MockLLMCaller({ quality: 0.9 });
  }

  const reg = PROVIDER_REGISTRY[provider];
  if (!reg) {
    throw new Error(`unknown provider: ${provider} (expected ${SUPPORTED_PROVIDERS})`);
  }

  const apiKey = process.env[reg.envKey] ?? (reg.keyOptional ? 'ollama' : undefined);
  if (!apiKey) {
    throw new Error(`provider "${provider}" requires ${reg.envKey} in .env or environment`);
  }

  if (provider === 'anthropic') {
    return new AnthropicCaller({
      apiKey,
      ...(reg.envBaseURL && process.env[reg.envBaseURL] ? { baseURL: process.env[reg.envBaseURL] } : {}),
      defaultModel: defaultModel || reg.defaultModel,
    });
  }

  if (provider === 'google') {
    return new GoogleCaller({
      apiKey,
      defaultModel: defaultModel || reg.defaultModel,
    });
  }

  let baseURL = reg.baseURL;
  if (reg.envBaseURL && process.env[reg.envBaseURL]) {
    baseURL = process.env[reg.envBaseURL]!;
  }

  if (provider === 'cloudflare') {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    if (!accountId) {
      throw new Error('provider "cloudflare" requires CLOUDFLARE_ACCOUNT_ID in .env or environment');
    }
    baseURL = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai`;
  }

  return new OpenAIChatCaller({
    apiKey,
    baseURL,
    defaultModel: defaultModel || reg.defaultModel,
    provider,
    pricing: PROVIDER_PRICING[provider] ?? {},
  });
}

// ── Helpers ──────────────────────────────────────────────────────────

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '…' : s;
}

function printTable(headers: string[], rows: string[][]): void {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)),
  );
  const sep = widths.map((w) => '─'.repeat(w + 2)).join('┼');
  const fmt = (row: string[]) =>
    row.map((cell, i) => ` ${cell.padEnd(widths[i]!)} `).join('│');

  process.stderr.write(`${fmt(headers)}\n${'─'.repeat(sep.length + 1)}\n`);
  for (const row of rows) {
    process.stderr.write(`${fmt(row)}\n`);
  }
}

function sinceFromWindow(window: string): string {
  const m = /^(\d+)([dh])$/.exec(window);
  if (!m) throw new Error(`invalid --window: ${window} (expected e.g. 7d, 24h, 30d)`);
  const n = Number(m[1]);
  const ms = m[2] === 'd' ? n * 24 * 60 * 60 * 1000 : n * 60 * 60 * 1000;
  return new Date(Date.now() - ms).toISOString();
}

async function saveTrace(name: string, json: string): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  const traceDir = resolve('.gatelane', 'traces', today);
  await mkdir(traceDir, { recursive: true });
  const tracePath = join(traceDir, `${name}-${crypto.randomUUID().slice(0, 8)}.json`);
  await writeFile(tracePath, json, 'utf-8');
  return tracePath;
}

/** Export turns to OTLP backend if configured. */
async function maybeExportOTel(
  config: GatelaneConfig,
  replayRows: ReadonlyArray<{ response: { content: string; cost_usd: number; latency_ms: number; tokens_in?: number; tokens_out?: number } }>,
): Promise<void> {
  if (!config.export?.otlp_endpoint) return;

  const turns = replayRows.map((row, i) => ({
    role: 'assistant' as const,
    content: row.response.content,
    span_id: `row-${i}`,
    span_kind: 'llm' as const,
    cost_usd: row.response.cost_usd,
    latency_ms: row.response.latency_ms,
    tokens_in: row.response.tokens_in,
    tokens_out: row.response.tokens_out,
    status: 'ok' as const,
  }));

  const otelConfig: OTelExportConfig = {
    endpoint: config.export.otlp_endpoint,
    headers: config.export.otlp_headers,
    service_name: config.export.service_name,
  };

  try {
    const { exported } = await exportTurnsToOTel(turns, otelConfig);
    process.stderr.write(`  otel: exported ${exported} spans to ${config.export.otlp_endpoint}\n`);
  } catch (err) {
    process.stderr.write(`  otel: export failed — ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

function resolveCommonArgs(argv: ReadonlyArray<string>, config: GatelaneConfig) {
  const { multi, single } = parseArgs(argv);
  const candidates = multi['candidate']?.length ? multi['candidate'] : config.candidates ?? [];
  const judgesRaw = multi['judges']?.[0];
  const judges = judgesRaw ? judgesRaw.split(',').map((s) => s.trim()).filter(Boolean) : config.judges ?? [];
  const defaultProvider = resolveProvider(multi['provider']?.[0] ?? config.provider);
  const judgeProvider = resolveProvider(multi['judge-provider']?.[0] ?? config.judge_provider ?? multi['provider']?.[0] ?? config.provider);
  const signingKey = multi['signing-key']?.[0] ?? config.signing_key ?? process.env.GATELANE_SIGNING_KEY ?? 'dev-only-insecure-signing-key';
  const reportPath = multi['report']?.[0] ?? config.report;
  const baseline = multi['baseline']?.[0] ?? config.baseline;
  const format = multi['format']?.[0] ?? config.format;
  return { multi, single, candidates, judges, defaultProvider, judgeProvider, signingKey, reportPath, baseline, format };
}

function buildCallers(refs: string[], defaultProvider: string): Record<string, LLMCaller> {
  const callers: Record<string, LLMCaller> = {};
  for (const ref of refs) {
    const { provider, model } = parseProviderModel(ref, defaultProvider);
    callers[ref] = makeCaller(provider, model);
  }
  return callers;
}

const CONCURRENCY_LIMIT = 5;

// ── scan ─────────────────────────────────────────────────────────────

function printScanTable(
  report: AttackReport,
  replayRows: ScanReplayRow[],
  dataset: FrozenDataset,
): void {
  // Red Team summary
  process.stderr.write('\n  ── Red Team: 20 attacks launched ──\n');

  for (const c of report.candidates) {
    // Blue Team (candidate) summary
    process.stderr.write(`\n  ── Blue Team: ${c.candidate_ref} ──\n\n`);
    printTable(
      ['Survived', 'Failed', 'Survival Rate'],
      [[String(c.survived), String(c.failed), `${(c.survival_rate * 100).toFixed(0)}%`]],
    );

    // By category
    process.stderr.write(`\n  ── ${c.candidate_ref} by category ──\n\n`);
    printTable(
      ['Category', 'Survived', 'Failed', 'Total'],
      Object.entries(c.by_category).map(([cat, stats]) => [
        cat, String(stats.survived), String(stats.failed), String(stats.total),
      ]),
    );

    // Vulnerabilities with attack content + model response
    if (c.vulnerabilities.length > 0) {
      process.stderr.write(`\n  ── Vulnerabilities: ${c.candidate_ref} (${c.vulnerabilities.length}) ──\n\n`);

      const vulnRows = c.vulnerabilities.map((v) => {
        // Find the attack input from the dataset
        const item = dataset.items?.find((it) => it.id === v.item_id);
        const attackContent = item?.input
          ? (typeof item.input === 'string' ? item.input : JSON.stringify(item.input))
          : '-';
        // Find the model response from replay rows
        const row = replayRows.find((r) => r.item_id === v.item_id && r.candidate_ref === c.candidate_ref);
        const responseContent = row?.content ?? '-';

        return [
          v.item_id,
          v.category,
          v.mapped_asi,
          truncate(attackContent, 60),
          truncate(responseContent, 60),
        ];
      });
      printTable(['ID', 'Category', 'ASI', 'Attack', 'Response'], vulnRows);
    } else {
      process.stderr.write(`\n  ✓ No vulnerabilities found for ${c.candidate_ref}\n`);
    }
  }

  // OWASP ASI gaps
  if (report.by_asi.length > 0) {
    process.stderr.write('\n  ── OWASP ASI Gaps ──\n\n');
    printTable(
      ['ASI', 'Failed', 'Total', 'Fail Rate'],
      report.by_asi.map((a) => [a.asi, String(a.failed), String(a.total), `${(a.fail_rate * 100).toFixed(0)}%`]),
    );
  }
}

async function cmdScan(argv: ReadonlyArray<string>): Promise<number> {
  const config = await loadConfig(parseArgs(argv).multi['config']?.[0]);
  const args = resolveCommonArgs(argv, config);
  const { candidates, judges, defaultProvider, judgeProvider, signingKey, reportPath, baseline } = args;
  const format = (args.format ?? 'table') as 'json' | 'table';

  if (candidates.length === 0 || judges.length === 0) {
    process.stderr.write(
      'error: candidates and judges are required.\n' +
      '       Set them in gatelane.config.yaml or pass --candidate / --judges flags.\n',
    );
    return 2;
  }

  process.stderr.write('\n  mode:       scan (security probes)\n');
  process.stderr.write(`  candidates: ${candidates.join(', ')}\n`);
  process.stderr.write(`  judges:     ${judges.join(', ')}\n`);
  process.stderr.write(`  vectors:    20 (4 categories)\n`);
  if (baseline) process.stderr.write(`  baseline:   ${baseline} (patch verification)\n`);
  process.stderr.write('\n');

  const dataset = await freezeInjectionDataset();
  const candidateCallers = buildCallers(candidates, defaultProvider);
  const judgeCallers = buildCallers(judges, judgeProvider);

  const result = await runRedTeamGate({
    dataset, candidates, judges,
    caller: candidateCallers[candidates[0]!]!,
    judge_callers: judgeCallers,
    signing_key: signingKey,
  });

  // Table output with attack content + model response
  if (format === 'table') {
    printScanTable(result.attackReport, result.replayRows, dataset);

    if (result.gateResult) {
      const d = result.gateResult.decision;
      process.stderr.write(`\n  gate: ${d.action}`);
      if ('winner' in d) process.stderr.write(` → ${(d as { winner: string }).winner}`);
      process.stderr.write(` (${d.reason})\n`);
    }
  }

  // Baseline comparison (patch verification)
  if (baseline && candidates.length >= 2) {
    const patchedCandidates = candidates.filter((c) => c !== baseline);
    for (const patched of patchedCandidates) {
      // Run baseline separately
      const baselineResult = await runRedTeamGate({
        dataset, candidates: [baseline], judges,
        caller: candidateCallers[baseline] ?? makeCaller(...Object.values(parseProviderModel(baseline, defaultProvider)) as [string, string]),
        judge_callers: judgeCallers, signing_key: signingKey,
      });

      const patchedResult = await runRedTeamGate({
        dataset, candidates: [patched], judges,
        caller: candidateCallers[patched]!,
        judge_callers: judgeCallers, signing_key: signingKey,
      });

      const verdict = verifyPatchHolds({
        before: baselineResult.attackReport,
        after: patchedResult.attackReport,
        baselineCandidate: baseline,
        patchedCandidate: patched,
      });

      process.stderr.write(`\n  ── Patch Verification: ${baseline} → ${patched} ──\n\n`);
      const bSummary = baselineResult.attackReport.candidates[0]!;
      const aSummary = patchedResult.attackReport.candidates[0]!;
      printTable(
        ['', 'Baseline', 'Patched'],
        [
          ['Survived', String(bSummary.survived), String(aSummary.survived)],
          ['Failed', String(bSummary.failed), String(aSummary.failed)],
          ['Survival Rate', `${(bSummary.survival_rate * 100).toFixed(0)}%`, `${(aSummary.survival_rate * 100).toFixed(0)}%`],
        ],
      );
      process.stderr.write(`\n  resolved:         ${verdict.resolved.length} vulnerabilities fixed\n`);
      process.stderr.write(`  still vulnerable: ${verdict.stillVulnerable.length}\n`);
      process.stderr.write(`  regressions:      ${verdict.regressed.length}\n`);
      process.stderr.write(`\n  verdict: ${verdict.holds ? '✓ PATCH HOLDS' : '✗ PATCH DOES NOT HOLD'}\n`);

      if (verdict.regressed.length > 0) {
        process.stderr.write('\n  Regressions:\n');
        for (const id of verdict.regressed) process.stderr.write(`    ✗ ${id}\n`);
      }
      if (verdict.stillVulnerable.length > 0) {
        process.stderr.write('\n  Still Vulnerable:\n');
        for (const id of verdict.stillVulnerable) process.stderr.write(`    ! ${id}\n`);
      }
    }
  }

  // Build full JSON report
  const fullReport = {
    mode: 'scan',
    generated_at: result.attackReport.generated_at,
    dataset_content_hash: result.attackReport.dataset_content_hash,
    candidates: result.attackReport.candidates.map((c) => ({
      candidate_ref: c.candidate_ref,
      total: c.total,
      survived: c.survived,
      failed: c.failed,
      survival_rate: c.survival_rate,
      by_category: c.by_category,
      vulnerabilities: c.vulnerabilities.map((v) => {
        const item = dataset.items?.find((it) => it.id === v.item_id);
        const attackContent = item?.input
          ? (typeof item.input === 'string' ? item.input : JSON.stringify(item.input))
          : '';
        const row = result.replayRows.find((r) => r.item_id === v.item_id && r.candidate_ref === c.candidate_ref);
        return {
          item_id: v.item_id,
          category: v.category,
          mapped_asi: v.mapped_asi,
          score: v.score,
          outcome: v.outcome,
          reasoning: v.reasoning,
          attack: truncate(attackContent, 500),
          response: truncate(row?.content ?? '', 500),
        };
      }),
    })),
    by_asi: result.attackReport.by_asi,
    gate_decision: result.gateResult?.decision ?? null,
  };

  const json = JSON.stringify(fullReport, null, 2);
  if (reportPath) {
    await writeFile(reportPath, json, 'utf-8');
    process.stderr.write(`\n  report: ${reportPath}\n`);
  }
  const tracePath = await saveTrace('scan', json);
  process.stderr.write(`  traces: ${tracePath}\n`);

  await maybeExportOTel(config, result.replayRows.map((r) => ({
    response: { content: r.content, cost_usd: r.cost_usd, latency_ms: r.latency_ms },
  })));

  if (!reportPath) process.stdout.write(json + '\n');

  return 0;
}

// ── eval ─────────────────────────────────────────────────────────────

async function cmdEval(argv: ReadonlyArray<string>): Promise<number> {
  const config = await loadConfig(parseArgs(argv).multi['config']?.[0]);
  const args = resolveCommonArgs(argv, config);
  const { multi, single, candidates, judges, defaultProvider, judgeProvider, signingKey, reportPath, baseline } = args;
  const format = (args.format ?? 'json') as 'json' | 'table';
  const dryRun = single['dry-run'] === true;

  const datasetSource = (multi['dataset-source']?.[0] ?? config.dataset_source ?? 'redteam') as DatasetSourceKind;
  const datasetPath = multi['dataset']?.[0] ?? config.dataset;
  const threshold = Number(multi['threshold']?.[0] ?? config.threshold ?? 0.02);

  if (candidates.length === 0 || judges.length === 0) {
    process.stderr.write(
      'error: candidates and judges are required.\n' +
      '       Set them in gatelane.config.yaml or pass --candidate / --judges flags.\n' +
      '       Run `gatelane init` to create a starter config.\n',
    );
    return 2;
  }
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    process.stderr.write(`error: threshold must be 0..1, got ${threshold}\n`);
    return 2;
  }

  process.stderr.write(`\n  mode:       eval (quality evaluation)\n`);
  process.stderr.write(`  candidates: ${candidates.join(', ')}\n`);
  process.stderr.write(`  judges:     ${judges.join(', ')}\n`);
  process.stderr.write(`  threshold:  ${threshold}\n`);
  if (datasetPath) process.stderr.write(`  dataset:    ${datasetPath}\n`);
  else process.stderr.write(`  dataset:    ${datasetSource} (generated)\n`);
  process.stderr.write(`  format:     ${format}\n`);

  if (dryRun) {
    process.stderr.write('\n  [dry-run] validating providers...\n');
    const errors: string[] = [];
    for (const ref of [...candidates, ...judges]) {
      const { provider } = parseProviderModel(ref, defaultProvider);
      if (provider === 'mock') continue;
      const reg = PROVIDER_REGISTRY[provider];
      if (!reg) { errors.push(`  ✗ ${ref}: unknown provider "${provider}"`); continue; }
      const hasKey = !!process.env[reg.envKey] || reg.keyOptional;
      if (hasKey) process.stderr.write(`  ✓ ${ref} — ${reg.envKey} found\n`);
      else errors.push(`  ✗ ${ref}: missing ${reg.envKey}`);
      if (provider === 'cloudflare' && !process.env.CLOUDFLARE_ACCOUNT_ID) {
        errors.push(`  ✗ ${ref}: missing CLOUDFLARE_ACCOUNT_ID`);
      }
    }
    if (errors.length > 0) {
      process.stderr.write('\n  errors:\n' + errors.join('\n') + '\n');
      return 1;
    }
    process.stderr.write('\n  [dry-run] all providers valid. Ready to run.\n');
    return 0;
  }

  process.stderr.write('\n');

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

  const candidateCallers = buildCallers(candidates, defaultProvider);
  const judgeCallers = buildCallers(judges, judgeProvider);
  const firstCandidateCaller = candidateCallers[candidates[0]!]!;

  const runner = createRunner({
    caller: firstCandidateCaller,
    judge_callers: judgeCallers,
    signing_key: signingKey,
    concurrency: CONCURRENCY_LIMIT,
    messages_from_item: (item) => {
      const input = item.input;
      if (Array.isArray(input)) {
        return input
          .filter((m): m is { role: string; content: string } =>
            typeof m === 'object' && m !== null && 'role' in m && 'content' in m)
          .map((m) => ({ role: m.role as 'system' | 'user' | 'assistant', content: m.content }));
      }
      return [{ role: 'user', content: String(input ?? '') }];
    },
  });
  const { setGateRunner, runGate, resetGateRunner } = await import('@lanefoundry/gatelane-sdk/gate');
  setGateRunner(runner);
  try {
    const result = await runGate({
      candidates, dataset, judges,
      ...(baseline !== undefined ? { baseline } : {}),
      policy: {
        min_delta: threshold,
        judge_stability_threshold: 0.67,
        cost_ceiling: 0.1,
        latency_ceiling: 0.2,
        approval_required: false,
      },
    });

    const metrics = result.candidate_metrics ?? {};
    const decisionAction = typeof result.decision === 'object' && result.decision !== null
      ? (result.decision as { action: string }).action : String(result.decision);
    const decisionWinner = typeof result.decision === 'object' && result.decision !== null && 'winner' in result.decision
      ? String((result.decision as { winner: string }).winner) : undefined;
    const decisionReason = typeof result.decision === 'object' && result.decision !== null && 'reason' in result.decision
      ? String((result.decision as { reason: string }).reason) : undefined;

    if (format === 'table') {
      const tableRows = candidates.map((ref) => {
        const m = metrics[ref];
        const isWinner = decisionWinner === ref;
        return [
          ref,
          m ? m.mean_score.toFixed(2) : '-',
          m ? `${(m.pass_rate * 100).toFixed(0)}%` : '-',
          m ? `$${m.total_cost_usd.toFixed(4)}` : '-',
          m ? `${m.mean_latency_ms.toFixed(0)}ms` : '-',
          m ? String(m.n_items) : '-',
          isWinner ? `✓ ${decisionAction}` : '-',
        ];
      });
      process.stderr.write('\n');
      printTable(['Candidate', 'Score', 'Pass Rate', 'Cost', 'Latency', 'Items', 'Decision'], tableRows);
      process.stderr.write(`\n  eval: ${decisionAction}`);
      if (decisionWinner) process.stderr.write(` → ${decisionWinner}`);
      if (decisionReason) process.stderr.write(` (${decisionReason})`);
      process.stderr.write('\n\n');

      // Before/after diff when baseline + one candidate
      if (baseline && candidates.length === 2) {
        const replayRows = result.replay_rows ?? [];
        const verdicts = result.verdicts ?? [];
        const otherCandidate = candidates.find((c) => c !== baseline)!;

        const itemIds = [...new Set(replayRows.map((r) => r.item_id))];
        let improved = 0, unchanged = 0, regressed = 0;
        const diffItems: Array<{ id: string; input: string; bl: string; blScore: number; cd: string; cdScore: number; delta: number; status: string }> = [];

        for (const itemId of itemIds) {
          const blRow = replayRows.find((r) => r.item_id === itemId && r.candidate_ref === baseline);
          const cdRow = replayRows.find((r) => r.item_id === itemId && r.candidate_ref === otherCandidate);
          const blVerdict = verdicts.find((v) => v.item_id === itemId && v.candidate_ref === baseline);
          const cdVerdict = verdicts.find((v) => v.item_id === itemId && v.candidate_ref === otherCandidate);
          if (!blRow || !cdRow) continue;

          const blScore = blVerdict?.score ?? 0;
          const cdScore = cdVerdict?.score ?? 0;
          const delta = cdScore - blScore;
          let status: string;
          if (delta > 0.05) { status = 'improved'; improved++; }
          else if (delta < -0.05) { status = 'regressed'; regressed++; }
          else { status = 'unchanged'; unchanged++; }

          const dsItem = dataset.items?.find((it) => (it.id ?? '<anonymous>') === itemId);
          const inputText = typeof dsItem?.input === 'string' ? dsItem.input : JSON.stringify(dsItem?.input ?? '');

          diffItems.push({ id: itemId, input: inputText, bl: blRow.response.content, blScore, cd: cdRow.response.content, cdScore, delta, status });
        }

        if (diffItems.length > 0) {
          process.stderr.write('  ── Item-by-item comparison ──\n');
          for (const d of diffItems) {
            const indicator = d.status === 'improved' ? '▲' : d.status === 'regressed' ? '▼' : '=';
            process.stderr.write(`\n  [${d.id}] "${truncate(d.input, 60)}"\n`);
            process.stderr.write(`    baseline (${baseline}):  "${truncate(d.bl, 80)}" (score: ${d.blScore.toFixed(2)})\n`);
            process.stderr.write(`    candidate (${otherCandidate}): "${truncate(d.cd, 80)}" (score: ${d.cdScore.toFixed(2)}) ${indicator}\n`);
          }
          process.stderr.write(`\n  ── Summary: ${improved} improved, ${unchanged} unchanged, ${regressed} regressed ──\n\n`);
        }
      }
    }

    // Build diff data for JSON report
    const diffData: Array<{ item_id: string; input: string; baseline: { content: string; score: number } | null; candidate: { content: string; score: number } | null; delta: number; status: string }> = [];
    if (baseline && candidates.length === 2) {
      const replayRows = result.replay_rows ?? [];
      const verdicts = result.verdicts ?? [];
      const otherCandidate = candidates.find((c) => c !== baseline)!;
      const itemIds = [...new Set(replayRows.map((r) => r.item_id))];
      for (const itemId of itemIds) {
        const blRow = replayRows.find((r) => r.item_id === itemId && r.candidate_ref === baseline);
        const cdRow = replayRows.find((r) => r.item_id === itemId && r.candidate_ref === otherCandidate);
        const blVerdict = verdicts.find((v) => v.item_id === itemId && v.candidate_ref === baseline);
        const cdVerdict = verdicts.find((v) => v.item_id === itemId && v.candidate_ref === otherCandidate);
        const blScore = blVerdict?.score ?? 0;
        const cdScore = cdVerdict?.score ?? 0;
        const delta = cdScore - blScore;
        const dsItem = dataset.items?.find((it) => (it.id ?? '<anonymous>') === itemId);
        const inputText = typeof dsItem?.input === 'string' ? dsItem.input : JSON.stringify(dsItem?.input ?? '');
        diffData.push({
          item_id: itemId,
          input: inputText,
          baseline: blRow ? { content: truncate(blRow.response.content, 500), score: blScore } : null,
          candidate: cdRow ? { content: truncate(cdRow.response.content, 500), score: cdScore } : null,
          delta,
          status: delta > 0.05 ? 'improved' : delta < -0.05 ? 'regressed' : 'unchanged',
        });
      }
    }

    const fullReport = {
      mode: 'eval',
      gate_run_id: result.report.gate_run_id,
      report_id: result.report.id,
      decision: result.decision,
      timestamp: result.report.timestamp,
      candidate_shas: result.report.candidate_shas,
      judge_shas: result.report.judge_shas,
      signature: result.report.signature,
      candidate_metrics: Object.fromEntries(
        Object.entries(metrics).map(([ref, m]) => [ref, {
          mean_score: m.mean_score, pass_rate: m.pass_rate, n_items: m.n_items,
          total_cost_usd: m.total_cost_usd, mean_latency_ms: m.mean_latency_ms,
          aggregate_delta: m.aggregate_delta, cost_delta: m.cost_delta, latency_delta: m.latency_delta,
        }]),
      ),
      verdicts: (result.verdicts ?? []).map((v) => ({
        candidate_ref: v.candidate_ref, judge_ref: v.judge_ref, item_id: v.item_id,
        outcome: v.outcome, score: v.score, reasoning: v.reasoning,
      })),
      replay_rows: (result.replay_rows ?? []).map((r) => ({
        item_id: r.item_id, candidate_ref: r.candidate_ref,
        content: truncate(r.response.content, 500),
        cost_usd: r.response.cost_usd, latency_ms: r.response.latency_ms,
        tokens_in: r.response.tokens_in, tokens_out: r.response.tokens_out,
      })),
      policy: result.report.policy,
      ...(diffData.length > 0 ? { diff: diffData } : {}),
    };

    const json = JSON.stringify(fullReport, null, 2);
    if (reportPath) {
      await writeFile(reportPath, json, 'utf-8');
      process.stderr.write(`  report: ${reportPath}\n`);
    }
    const tracePath = await saveTrace('eval', json);
    process.stderr.write(`  traces: ${tracePath}\n`);

    await maybeExportOTel(config, (result.replay_rows ?? []).map((r) => ({ response: r.response })));

    if (!reportPath) process.stdout.write(json + '\n');
    return 0;
  } finally {
    resetGateRunner();
  }
}

// ── run (scan + eval) ────────────────────────────────────────────────

async function cmdRun(argv: ReadonlyArray<string>): Promise<number> {
  process.stderr.write('\n  ═══ gatelane run: scan + eval ═══\n');

  process.stderr.write('\n  ── Phase 1: scan ──\n');
  const scanResult = await cmdScan(argv);
  if (scanResult !== 0) return scanResult;

  process.stderr.write('\n  ── Phase 2: eval ──\n');
  const evalResult = await cmdEval(argv);
  return evalResult;
}

// ── snapshot ─────────────────────────────────────────────────────────

async function cmdSnapshot(argv: ReadonlyArray<string>): Promise<number> {
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
      'error: snapshot needs a Worker endpoint. Pass --endpoint <url> --token <capture-token>\n' +
        '       or set GATELANE_ENDPOINT / GATELANE_CAPTURE_TOKEN in .env.\n',
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
    expected: c.output,
    metadata: {
      model: c.input.model,
      cost_usd: c.cost_usd,
      latency_ms: c.latency_ms,
      captured_at: c.completed_at,
      ...(c.input.metadata ?? {}),
    },
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

// ── init ─────────────────────────────────────────────────────────────

async function cmdInit(): Promise<number> {
  const configPath = resolve('gatelane.config.yaml');
  try {
    await access(configPath);
    process.stderr.write('gatelane.config.yaml already exists. Delete it first to re-init.\n');
    return 1;
  } catch {
    // File doesn't exist, good
  }

  const starter = `# gatelane config — edit candidates/judges, put API keys in .env
# Docs: https://github.com/lanefoundry/gatelane

candidates:
  - openai:gpt-4o-mini
  # - anthropic:claude-3-5-haiku
  # - groq:llama-3.1-70b-versatile
  # - google:gemini-2.5-flash
  # - openrouter:mistralai/mistral-large-latest
  # - cloudflare:@cf/meta/llama-3.1-8b-instruct
  # - opencode:deepseek-v4-flash
  # - ollama:llama3.1

judges:
  - openai:gpt-4o

# dataset: my-dataset.json      # frozen dataset file
# dataset_source: redteam       # or: prod, compliance
threshold: 0.02
# baseline: openai:gpt-4o-mini  # compare against this candidate
# report: report.json           # write report to file
# format: table                 # or: json (default for eval)

# OTel export (sends traces to Langfuse, Jaeger, Datadog, Grafana Tempo, etc.)
# export:
#   otlp_endpoint: https://cloud.langfuse.com/api/public/otel
#   otlp_headers:
#     Authorization: "Basic <base64(publicKey:secretKey)>"
#   service_name: my-agent
`;

  await writeFile(configPath, starter, 'utf-8');
  process.stdout.write('Created gatelane.config.yaml\n');
  process.stdout.write('Next: add your API keys to .env, then run `npx gatelane scan` or `npx gatelane eval`\n');
  return 0;
}

// ── canary ──────────────────────────────────────────────────────────

function printCanaryRecord(record: CanaryRecord): void {
  process.stderr.write(`\n  canary:     ${record.id}\n`);
  process.stderr.write(`  state:      ${record.state}\n`);
  process.stderr.write(`  candidate:  ${record.candidateRef}\n`);
  process.stderr.write(`  traffic:    ${record.trafficPercent}%\n`);
  process.stderr.write(`  started:    ${record.startedAt}\n`);
  if (record.observationEndsAt) process.stderr.write(`  observe til: ${record.observationEndsAt}\n`);
  if (record.completedAt) process.stderr.write(`  completed:  ${record.completedAt}\n`);
  if (record.error) process.stderr.write(`  error:      ${record.error}\n`);
  if (record.observations.length > 0) {
    process.stderr.write(`  observations: ${record.observations.length}\n`);
  }
}

async function cmdCanary(argv: ReadonlyArray<string>): Promise<number> {
  const { positional, multi } = parseArgs(argv);
  const subcommand = positional[0];

  if (!subcommand) {
    process.stderr.write('error: canary requires a subcommand: start | status | observe | advance | rollback | tick\n');
    return 2;
  }

  setCanaryStorage(new InMemoryCanaryStorage());

  switch (subcommand) {
    case 'start': {
      const reportPath = multi['report']?.[0];
      if (!reportPath) {
        process.stderr.write('error: --report <path> is required for canary start\n');
        return 2;
      }

      const raw = JSON.parse(await readFile(resolve(reportPath), 'utf-8')) as Record<string, unknown>;
      const report = raw.report ?? raw;
      const decision = (raw.decision ?? { action: 'promote', winner: '', reason: '' }) as { action: string; winner?: string; reason: string };

      if (decision.action !== 'promote') {
        process.stderr.write(`error: cannot start canary — decision is "${decision.action}", expected "promote"\n`);
        return 1;
      }

      const gateRunId = (report as Record<string, unknown>).gate_run_id as string ?? `cli-${Date.now()}`;
      const candidateRef = decision.winner ?? 'unknown';

      process.stderr.write('\n  mode:       canary start\n');
      process.stderr.write(`  report:     ${reportPath}\n`);
      process.stderr.write(`  candidate:  ${candidateRef}\n`);
      process.stderr.write(`  gate run:   ${gateRunId}\n\n`);

      const result = await startCanary({
        gateRunId,
        candidateRef,
        report: report as Parameters<typeof startCanary>[0]['report'],
        decision: decision as Parameters<typeof startCanary>[0]['decision'],
        initialTrafficPercent: Number(multi['traffic']?.[0] ?? 10),
        observationWindow: multi['window']?.[0],
      });

      printCanaryRecord(result.record);
      process.stdout.write(JSON.stringify({ canary_id: result.record.id, state: result.record.state }, null, 2) + '\n');
      return 0;
    }

    case 'status': {
      const id = multi['id']?.[0];

      if (id) {
        const record = await getCanaryStorage().read(id);
        if (!record) {
          process.stderr.write(`error: canary not found: ${id}\n`);
          return 1;
        }
        printCanaryRecord(record);
        process.stdout.write(JSON.stringify(record, null, 2) + '\n');
      } else {
        const active = await getActiveCanaries();
        const all = await getCanaryStorage().list({ limit: 20 });

        process.stderr.write(`\n  canaries: ${all.length} total, ${active.length} active\n\n`);

        if (all.length > 0) {
          printTable(
            ['ID', 'State', 'Candidate', 'Traffic', 'Started', 'Observation Ends'],
            all.map((r) => [
              r.id,
              r.state,
              r.candidateRef,
              `${r.trafficPercent}%`,
              r.startedAt.slice(0, 19),
              r.observationEndsAt?.slice(0, 19) ?? '-',
            ]),
          );
        }
      }
      return 0;
    }

    case 'observe': {
      const id = multi['id']?.[0];
      const metric = multi['metric']?.[0];
      const value = multi['value']?.[0];
      const baseline = multi['baseline']?.[0];

      if (!id || !metric || !value || !baseline) {
        process.stderr.write('error: canary observe requires --id, --metric, --value, --baseline\n');
        return 2;
      }

      const result = await recordObservation(id, metric, Number(value), Number(baseline));
      printCanaryRecord(result.record);

      if (result.record.state === 'rolled_back') {
        process.stderr.write('\n  ✗ AUTO-ROLLBACK triggered\n');
      }

      process.stdout.write(JSON.stringify({ state: result.record.state, advanced: result.advanced }, null, 2) + '\n');
      return result.record.state === 'rolled_back' ? 1 : 0;
    }

    case 'advance': {
      const id = multi['id']?.[0];
      if (!id) {
        process.stderr.write('error: --id is required for canary advance\n');
        return 2;
      }

      const result = await advanceCanary(id);
      printCanaryRecord(result.record);
      process.stdout.write(JSON.stringify({ state: result.record.state, advanced: result.advanced }, null, 2) + '\n');
      return 0;
    }

    case 'rollback': {
      const id = multi['id']?.[0];
      const reason = multi['reason']?.[0];
      if (!id || !reason) {
        process.stderr.write('error: canary rollback requires --id and --reason\n');
        return 2;
      }

      const result = await rollbackCanary(id, reason);
      printCanaryRecord(result.record);
      process.stderr.write('\n  ✗ Canary rolled back\n');
      process.stdout.write(JSON.stringify({ state: result.record.state }, null, 2) + '\n');
      return 0;
    }

    case 'tick': {
      const changed = await tickCanaries();
      process.stderr.write(`\n  canary tick: ${changed.length} canaries advanced\n`);

      for (const record of changed) {
        printCanaryRecord(record);
      }

      if (changed.length === 0) {
        process.stderr.write('  (no canaries ready to advance)\n');
      }

      process.stdout.write(JSON.stringify({ advanced: changed.length, records: changed.map((r) => ({ id: r.id, state: r.state })) }, null, 2) + '\n');
      return 0;
    }

    default:
      process.stderr.write(`error: unknown canary subcommand: ${subcommand}\n`);
      process.stderr.write('  valid subcommands: start | status | observe | advance | rollback | tick\n');
      return 2;
  }
}

// ── Main ─────────────────────────────────────────────────────────────

async function main(argv: ReadonlyArray<string>): Promise<number> {
  const envFileIdx = argv.indexOf('--env-file');
  if (envFileIdx !== -1 && argv[envFileIdx + 1]) {
    loadDotenv({ path: resolve(argv[envFileIdx + 1]) });
  } else {
    loadDotenv();
  }

  const command = argv[0];
  if (command === undefined || command === '--help' || command === '-h') {
    process.stdout.write(HELP);
    return 0;
  }
  if (command === 'scan') return cmdScan(argv.slice(1));
  if (command === 'eval') return cmdEval(argv.slice(1));
  if (command === 'run') return cmdRun(argv.slice(1));
  if (command === 'snapshot') return cmdSnapshot(argv.slice(1));
  if (command === 'canary') return cmdCanary(argv.slice(1));
  if (command === 'init') return cmdInit();
  // Backwards compat aliases
  if (command === 'gate') return cmdEval(argv.slice(1));
  if (command === 'redteam') return cmdScan(argv.slice(1));
  if (command === 'freeze-slice') return cmdSnapshot(argv.slice(1));
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
