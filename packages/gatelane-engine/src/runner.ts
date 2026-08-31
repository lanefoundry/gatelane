/**
 * Real runGate runner — orchestrates replay + judge + compare + sign + evaluate.
 *
 * This is what gets installed into the SDK via `setGateRunner()`. Decoupled
 * from the SDK shape so the engine can evolve without breaking SDK consumers.
 *
 * Flow:
 *   1. Resolve each candidate ref → { ref, model, messages_from_item }.
 *   2. Replay each (candidate, item) via LLMCaller.
 *   3. For each (candidate, item, judge), call LLMJudge and parse verdict.
 *   4. Compare → per-candidate metrics + judge matrix.
 *   5. Sign the resulting PromotionReport via HMAC-SHA256.
 *   6. Evaluate policy → PromotionDecision.
 *
 * @see docs/prd.md §5.1 — The gate
 */
import type { DatasetItem } from '@lanefoundry/gatelane-sdk/dataset';
import {
  type GateRunArgs,
  type GateRunResult,
  type GateRunner,
} from '@lanefoundry/gatelane-sdk/gate';
import type { PromotionReport } from '@lanefoundry/gatelane-sdk/promotion';
import { shaOfCandidateRef } from '@lanefoundry/gatelane-sdk';
import { DEFAULT_POLICY } from '@lanefoundry/gatelane-sdk';

import type { LLMCaller, LLMRequest } from './llm.js';
import { replay, type ReplayArgs } from './replay.js';
import { LLMJudge, type JudgeVerdict } from './judge.js';
import { compare } from './compare.js';
import { signReport } from './sign.js';
import { evaluate } from './evaluate.js';
import {
  createAndAppendAuditEntry,
  type AuditLogEntry,
  type AuditEventType,
} from './audit.js';
import { initTracing, withGateSpan, type GateStage } from './tracing.js';
import type { D1DatabaseLike } from '@lanefoundry/gatelane-sdk';

export type RunnerOptions = {
  /** Caller used for both candidate invocations and judge calls. */
  caller: LLMCaller;
  /** Per-judge LLMCallers (optional; defaults to `caller`). */
  judge_callers?: Record<string, LLMCaller>;
  /** HMAC signing key. Required. */
  signing_key: string;
  /** Master seed for replay determinism. */
  seed?: number;
  /** Replay twice to compute determinism_score. Doubles cost. */
  measureDeterminism?: boolean;
  /** How to extract chat messages from a dataset item. */
  messages_from_item?: (item: DatasetItem) => Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  /** Optional D1 database for audit log persistence. */
  audit_db?: D1DatabaseLike;
  /** Service name for OTel tracing. */
  tracing_service_name?: string;
};

export function createRunner(opts: RunnerOptions): GateRunner {
  // Initialize tracing
  initTracing(opts.tracing_service_name ?? 'gatelane-engine');

  const messages_from_item =
    opts.messages_from_item ??
    ((item: DatasetItem) => {
      if (Array.isArray(item.input)) {
        return item.input
          .filter(
            (m): m is { role: string; content: string } =>
              typeof m === 'object' && m !== null && 'role' in m && 'content' in m,
          )
          .map((m) => ({ role: m.role as 'system' | 'user' | 'assistant', content: m.content }));
      }
      return [{ role: 'user', content: String(item.input ?? '') }];
    });

  return async function runGate(args: GateRunArgs): Promise<GateRunResult> {
    const policy = args.policy ?? DEFAULT_POLICY;
    const baseline = args.baseline;
    const runId = crypto.randomUUID();
    const reportId = crypto.randomUUID();
    const scorerCodeSha = await shaOfCandidateRef(`gatelane-engine:scorer:v0.0.1-dev`);

    const candidates = args.candidates.map((ref) => ({
      ref,
      model: ref.startsWith('model:') ? ref.slice('model:'.length) : ref,
      messages_from_item,
    }));

    // Stage 1: Replay
    const replayArgs: ReplayArgs = {
      dataset: args.dataset,
      candidates,
      caller: opts.caller,
      ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
      ...(opts.measureDeterminism !== undefined ? { measureDeterminism: opts.measureDeterminism } : {}),
    };
    const replayResult = await withGateSpan('replay', runId, async (span) => {
      const result = await replay(replayArgs);
      span.setAttribute('replay.items', args.dataset.items?.length ?? 0);
      span.setAttribute('replay.candidates', candidates.length);
      span.setAttribute('replay.determinism_score', result.determinism_score);
      span.setAttribute('replay.total_cost_usd', result.total_cost_usd);
      span.setAttribute('replay.total_latency_ms', result.total_latency_ms);
      return result;
    });

    // Audit: replay
    if (opts.audit_db) {
      await createAndAppendAuditEntry(runId, 'replay', {
        candidates: candidates.map(c => c.ref),
        items_count: args.dataset.items?.length ?? 0,
        determinism_score: replayResult.determinism_score,
        total_cost_usd: replayResult.total_cost_usd,
        total_latency_ms: replayResult.total_latency_ms,
      }, opts.signing_key, opts.audit_db);
    }

    // Stage 2: Judge
    const verdicts: JudgeVerdict[] = [];
    await withGateSpan('judge', runId, async (span) => {
      for (const cand of candidates) {
        for (const judgeRef of args.judges) {
          const judgeCaller = opts.judge_callers?.[judgeRef] ?? opts.caller;
          const judge = new LLMJudge({ name: judgeRef, caller: judgeCaller });
          const candRows = replayResult.rows.filter((r) => r.candidate_ref === cand.ref);
          for (const row of candRows) {
            const itemId = row.item_id;
            const itemInput = args.dataset.items?.find((it) => (it.id ?? '<anonymous>') === itemId)?.input;
            const v = await judge.judge({
              candidate_ref: cand.ref,
              item_id: itemId,
              item_input: itemInput ?? null,
              candidate_output: row.response.content,
            });
            verdicts.push(v);
          }
        }
      }
      span.setAttribute('judge.verdicts_count', verdicts.length);
      span.setAttribute('judge.judges', args.judges.join(','));
      span.setAttribute('judge.candidates', args.candidates.join(','));
    });

    // Audit: judge
    if (opts.audit_db) {
      await createAndAppendAuditEntry(runId, 'judge', {
        verdicts: verdicts.map(v => ({
          candidate_ref: v.candidate_ref,
          judge_ref: v.judge_ref,
          item_id: v.item_id,
          outcome: v.outcome,
          score: v.score,
          cost_usd: v.cost_usd,
          latency_ms: v.latency_ms,
        })),
      }, opts.signing_key, opts.audit_db);
    }

    // Stage 3: Compare
    const { perCandidate, judgeMatrix } = await withGateSpan('compare', runId, async (span) => {
      const result = compare({
        replay: replayResult,
        verdicts,
        ...(baseline !== undefined ? { baseline_ref: baseline } : {}),
      });
      span.setAttribute('compare.candidates', Object.keys(result.perCandidate).join(','));
      span.setAttribute('compare.consensus_winners', result.judgeMatrix.consensus_winners.join(','));
      return result;
    });

    // Audit: compare
    if (opts.audit_db) {
      await createAndAppendAuditEntry(runId, 'compare', {
        per_candidate: Object.fromEntries(
          Object.entries(perCandidate).map(([ref, m]) => [
            ref,
            {
              mean_score: m.mean_score,
              pass_rate: m.pass_rate,
              n_items: m.n_items,
              total_cost_usd: m.total_cost_usd,
              mean_latency_ms: m.mean_latency_ms,
              aggregate_delta: m.aggregate_delta,
              cost_delta: m.cost_delta,
              latency_delta: m.latency_delta,
            },
          ])
        ),
        judge_matrix: {
          candidates: judgeMatrix.candidates,
          judges: judgeMatrix.judges,
          winners_by_judge: judgeMatrix.winners_by_judge,
          consensus_winners: judgeMatrix.consensus_winners,
        },
      }, opts.signing_key, opts.audit_db);
    }

    const candidate_shas: Record<string, string> = {};
    for (const ref of args.candidates) candidate_shas[ref] = await shaOfCandidateRef(ref);
    const judge_shas: Record<string, string> = {};
    for (const j of args.judges) judge_shas[j] = await shaOfCandidateRef(j);

    const candidate_metrics: Record<string, { aggregate_delta: number; cost_delta: number; latency_delta: number }> = {};
    for (const [ref, m] of Object.entries(perCandidate)) {
      candidate_metrics[ref] = {
        aggregate_delta: m.aggregate_delta,
        cost_delta: m.cost_delta,
        latency_delta: m.latency_delta,
      };
    }
    const baseline_metrics: Record<string, number> = {};
    if (baseline !== undefined) {
      const b = perCandidate[baseline];
      if (b !== undefined) {
        baseline_metrics.primary_score = b.mean_score;
        baseline_metrics.cost = b.total_cost_usd;
        baseline_metrics.latency = b.mean_latency_ms;
      }
    }

    const baseReport: PromotionReport = {
      id: reportId,
      gate_run_id: runId,
      dataset_content_hash: args.dataset.content_hash,
      dataset_version: args.dataset.version,
      candidate_shas,
      judge_shas,
      scorer_code_sha: scorerCodeSha,
      baseline_metrics,
      candidate_metrics,
      judge_matrix: judgeMatrix,
      policy,
      ...(args.approver !== undefined ? { approver: args.approver } : {}),
      timestamp: new Date().toISOString(),
      signature: 'pending',
    };

    // Stage 4: Sign
    const signature = await withGateSpan('sign', runId, async (span) => {
      const sig = await signReport(baseReport, opts.signing_key);
      span.setAttribute('sign.report_id', reportId);
      span.setAttribute('sign.signature_length', sig.length);
      return sig;
    });
    const signed: PromotionReport = { ...baseReport, signature };

    // Audit: sign
    if (opts.audit_db) {
      await createAndAppendAuditEntry(runId, 'sign', {
        report_id: reportId,
        gate_run_id: runId,
        signature_length: signature.length,
      }, opts.signing_key, opts.audit_db);
    }

    // Stage 5: Evaluate
    const { decision } = await withGateSpan('evaluate', runId, async (span) => {
      const result = evaluate({
        candidates: args.candidates,
        perCandidate,
        judgeMatrix,
        policy,
        ...(args.approver !== undefined ? { approver: args.approver } : {}),
      });
      span.setAttribute('evaluate.action', result.decision.action);
      span.setAttribute('evaluate.winner', result.decision.action === 'promote' ? (result.decision as { winner: string }).winner : '');
      span.setAttribute('evaluate.reason', result.decision.reason);
      return result;
    });

    // Audit: promote (or rollback/hold)
    if (opts.audit_db) {
      await createAndAppendAuditEntry(runId, 'promote', {
        decision: decision.action,
        winner: decision.action === 'promote' ? (decision as { winner: string }).winner : undefined,
        reason: decision.reason,
      }, opts.signing_key, opts.audit_db);
    }

    return { report: signed, decision };
  };
}

export type { LLMRequest };