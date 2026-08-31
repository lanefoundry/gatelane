/**
 * Gate runner registry — the SDK defines the shape, the engine plugs in the impl.
 *
 * The default export is a stub that produces a deterministic mock. Production
 * installs the engine package and calls {@link setGateRunner} once at process
 * startup; subsequent {@link runGate} calls delegate to the engine.
 *
 * Decoupling: SDK doesn't depend on engine (engine depends on SDK). Test code
 * can install a fake runner for deterministic gate outputs.
 *
 * @see docs/prd.md §5.1 — The gate
 */

import { shaOfCandidateRef } from './candidate.js';
import type { FrozenDataset } from './dataset.js';
import {
  DEFAULT_POLICY,
  type PromotionDecision,
  type PromotionPolicy,
  type PromotionReport,
} from './promotion.js';

export type GateRunArgs = {
  readonly candidates: ReadonlyArray<string>;
  readonly dataset: FrozenDataset;
  readonly judges: ReadonlyArray<string>;
  readonly baseline?: string;
  readonly policy?: PromotionPolicy;
  readonly approver?: string;
};

export type GateRunResult = {
  readonly report: PromotionReport;
  readonly decision: PromotionDecision;
};

/** Runner interface. The engine implements this and registers it. */
export type GateRunner = (args: GateRunArgs) => Promise<GateRunResult>;

let registeredRunner: GateRunner | null = null;

/** Install the real engine runner. Idempotent; subsequent calls overwrite. */
export function setGateRunner(runner: GateRunner): void {
  registeredRunner = runner;
}

/** Reset to the stub runner. Tests use this. */
export function resetGateRunner(): void {
  registeredRunner = null;
}

/**
 * Run the gate. If an engine runner is installed, delegates to it.
 * Otherwise produces a deterministic mock report (W1 behavior).
 */
export async function runGate(args: GateRunArgs): Promise<GateRunResult> {
  if (registeredRunner !== null) {
    return registeredRunner(args);
  }
  return stubRunGate(args);
}

/** v0.0.0-dev stub — kept for SDK consumers that don't load the engine yet. */
export async function stubRunGate(args: GateRunArgs): Promise<GateRunResult> {
  const policy = args.policy ?? DEFAULT_POLICY;
  const baseline = args.baseline ?? 'model:baseline';
  const runId = crypto.randomUUID();
  const reportId = crypto.randomUUID();

  const candidate_shas: Record<string, string> = {};
  for (const ref of args.candidates) {
    candidate_shas[ref] = await shaOfCandidateRef(ref);
  }
  const judge_shas: Record<string, string> = {};
  for (const judge of args.judges) {
    judge_shas[judge] = await shaOfCandidateRef(judge);
  }

  const report: PromotionReport = {
    id: reportId,
    gate_run_id: runId,
    dataset_content_hash: args.dataset.content_hash,
    dataset_version: args.dataset.version,
    candidate_shas,
    judge_shas,
    scorer_code_sha: await shaOfCandidateRef('gatelane-sdk:scorer:v0.0.0-dev'),
    baseline_metrics: { primary_score: 0.7 },
    candidate_metrics: Object.fromEntries(
      args.candidates.map((ref) => [
        ref,
        { aggregate_delta: 0.05, cost_delta: 0.02, latency_delta: 0.03 },
      ]),
    ),
    judge_matrix: {
      candidates: args.candidates,
      judges: args.judges,
      winners_by_judge: Object.fromEntries(
        args.candidates.map((ref) => [ref, args.judges.length]),
      ),
      consensus_winners: args.candidates,
    },
    policy,
    ...(args.approver !== undefined ? { approver: args.approver } : {}),
    timestamp: new Date().toISOString(),
    signature: 'stub:unsigned',
  };

  const winner = args.candidates[0] ?? baseline;
  const decision: PromotionDecision = policy.approval_required
    ? { action: 'hold_for_review', reason: 'approval_required' }
    : {
        action: 'promote',
        winner,
        reason: `stub: all candidates passed policy (min_delta=${policy.min_delta})`,
      };

  return { report, decision };
}