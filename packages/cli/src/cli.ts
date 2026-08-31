#!/usr/bin/env node
/**
 * gatelane CLI — stub for v0.0.-dev.
 *
 * Real CLI parses args, talks to the gate engine, signs reports. For now this
 * just echoes what the SDK stub returns so the binary is importable + runnable.
 *
 * Usage:
 *   pnpm gatelane gate --candidate model:gpt-5 --candidate guardrail:v2 \
 *                      --judges gpt-4o,claude-sonnet \
 *                      --dataset-source redteam --report report.json
 *   pnpm gatelane freeze-slice --window 7d --output dataset.jsonl
 *   pnpm gatelane --help
 *
 * @see docs/prd.md §5.6 — SDK & API surface
 */
import { writeFile } from 'node:fs/promises';

import {
  freezeDataset,
  runGate,
  type DatasetSourceKind,
  type FrozenDataset,
} from '@lanefoundry/gatelane-sdk';

import { freezeInjectionDataset } from '@lanefoundry/gatelane-engine/attack';
import { createRunner, MockLLMCaller } from '@lanefoundry/gatelane-engine';


const HELP = `gatelane — promotion gate for AI agents

Usage:
  gatelane gate --candidate <ref> [--candidate <ref> ...] --judges <list>
                [--dataset-source redteam|prod|compliance]
                [--baseline <ref>]
                [--threshold <n>]
                [--report <path>]
  gatelane freeze-slice --window <7d|30d|...> --output <path>
  gatelane --help

v0.0.0-dev — stubs only; real engine wires up across W1–W6 per docs/roadmap.md.
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

async function cmdGate(argv: ReadonlyArray<string>): Promise<number> {
  const { multi } = parseArgs(argv);
  const candidates = multi['candidate'] ?? [];
  const judges = (multi['judges']?.[0] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const datasetSource = (multi['dataset-source']?.[0] ?? 'redteam') as DatasetSourceKind;
  const baseline = multi['baseline']?.[0] ?? 'model:baseline';
  const threshold = Number(multi['threshold']?.[0] ?? '0.02');
  const reportPath = multi['report']?.[0];
  const signingKey = multi['signing-key']?.[0];

  if (candidates.length === 0 || judges.length === 0) {
    process.stderr.write('error: --candidate and --judges are required\n');
    return 2;
  }
  let dataset: FrozenDataset;
  if (datasetSource === 'redteam') {
    dataset = await freezeInjectionDataset();
  } else {
    dataset = await freezeDataset({
      source_kind: datasetSource,
      source_ref: `${datasetSource}-stub@v0.0.0-dev`,
      items: [],
    });
  }

  // If signing key provided, use the real engine runner
  if (signingKey) {
    const runner = createRunner({
      caller: new MockLLMCaller({ quality: 0.9 }),
      signing_key: signingKey,
    });
    const { setGateRunner, runGate: runGateReal } = await import('@lanefoundry/gatelane-sdk/gate');
    setGateRunner(runner);
    try {
      const result = await runGateReal({
        candidates,
        dataset,
        judges,
        baseline,
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
      const { resetGateRunner } = await import('@lanefoundry/gatelane-sdk/gate');
      resetGateRunner();
    }
  }

  // Fallback to stub
  const result = await runGate({
    candidates,
    dataset,
    judges,
    baseline,
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
}

async function cmdFreezeSlice(argv: ReadonlyArray<string>): Promise<number> {
  const { multi } = parseArgs(argv);
  const window = multi['window']?.[0] ?? '7d';
  const output = multi['output']?.[0];
  if (!output) {
    process.stderr.write('error: --output is required\n');
    return 2;
  }
  const dataset = await freezeDataset({
    source_kind: 'prod',
    source_ref: `prod-slice-${window}@v0.0.0-dev`,
    slice_filter: { window },
    items: [],
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