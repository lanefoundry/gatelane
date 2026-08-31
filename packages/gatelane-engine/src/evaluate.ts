/**
 * PromotionPolicy evaluator — apply policy rules to compare() output and
 * return a PromotionDecision.
 *
 * Rules (per PRD §5.1):
 *   - min_delta: candidate.aggregate_delta must be ≥ min_delta to pass.
 *   - judge_stability_threshold: candidate must appear in judge_matrix.consensus_winners.
 *   - cost_ceiling: candidate.cost_delta must be ≤ cost_ceiling (vs baseline).
 *   - latency_ceiling: candidate.latency_delta must be ≤ latency_ceiling.
 *   - approval_required: even on pass, returns hold_for_review.
 *
 * @see docs/prd.md §5.1 — The gate
 */

import type { PromotionDecision, PromotionPolicy } from '@lanefoundry/gatelane-sdk/promotion';

import type { CandidateMetric } from './compare.js';
import type { JudgeStabilityMatrix } from '@lanefoundry/gatelane-sdk/promotion';

export type EvaluateArgs = {
  candidates: ReadonlyArray<string>;
  perCandidate: Record<string, CandidateMetric>;
  judgeMatrix: JudgeStabilityMatrix;
  policy: PromotionPolicy;
  /** Optional approver (when policy.approval_required). */
  approver?: string;
};

export type EvaluateResult = {
  decision: PromotionDecision;
  /** Per-rule pass/fail detail. */
  rule_results: {
    min_delta: Record<string, boolean>;
    judge_stability: Record<string, boolean>;
    cost_ceiling: Record<string, boolean>;
    latency_ceiling: Record<string, boolean>;
  };
};

/**
 * Evaluate all candidates against policy. The decision applies to the best
 * candidate that passes all rules; if multiple pass, the one with the highest
 * aggregate_delta wins. If none pass, the action is `rollback`. If
 * approval_required, every pass becomes `hold_for_review`.
 */
export function evaluate(args: EvaluateArgs): EvaluateResult {
  const { candidates, perCandidate, judgeMatrix, policy } = args;
  const consensus = new Set(judgeMatrix.consensus_winners);

  const rule_results: EvaluateResult['rule_results'] = {
    min_delta: {},
    judge_stability: {},
    cost_ceiling: {},
    latency_ceiling: {},
  };

  const passing: Array<{ ref: string; metric: CandidateMetric }> = [];

  for (const cand of candidates) {
    const m = perCandidate[cand];
    if (m === undefined) continue;

    const passMinDelta = m.aggregate_delta >= policy.min_delta;
    const passJudge = consensus.has(cand);
    const passCost = m.cost_delta <= policy.cost_ceiling;
    const passLatency = m.latency_delta <= policy.latency_ceiling;

    rule_results.min_delta[cand] = passMinDelta;
    rule_results.judge_stability[cand] = passJudge;
    rule_results.cost_ceiling[cand] = passCost;
    rule_results.latency_ceiling[cand] = passLatency;

    if (passMinDelta && passJudge && passCost && passLatency) {
      passing.push({ ref: cand, metric: m });
    }
  }

  if (passing.length === 0) {
    const reasons: string[] = [];
    for (const cand of candidates) {
      const r = rule_results;
      if (!r.min_delta[cand]) reasons.push(`${cand}: aggregate_delta < ${policy.min_delta}`);
      if (!r.judge_stability[cand]) reasons.push(`${cand}: not in judge consensus`);
      if (!r.cost_ceiling[cand]) reasons.push(`${cand}: cost_delta > ${policy.cost_ceiling}`);
      if (!r.latency_ceiling[cand]) reasons.push(`${cand}: latency_delta > ${policy.latency_ceiling}`);
    }
    return {
      decision: { action: 'rollback', reason: reasons.join('; ') },
      rule_results,
    };
  }

  passing.sort((a, b) => b.metric.aggregate_delta - a.metric.aggregate_delta);
  const winner = passing[0];
  if (winner === undefined) {
    return { decision: { action: 'rollback', reason: 'internal: no winner' }, rule_results };
  }

  if (policy.approval_required === true) {
    return {
      decision: {
        action: 'hold_for_review',
        reason: `winner=${winner.ref} passed all rules but approval_required=true (approver=${args.approver ?? 'unset'})`,
      },
      rule_results,
    };
  }

  return {
    decision: {
      action: 'promote',
      winner: winner.ref,
      reason: `winner=${winner.ref} passed all rules (Δ=${winner.metric.aggregate_delta.toFixed(4)})`,
    },
    rule_results,
  };
}