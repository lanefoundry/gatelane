/**
 * promotion-decision.ts — Apply PromotionPolicy rules to compare output.
 *
 * Reuses engine's evaluate() to produce a PromotionDecision.
 * Adds policy validation and detailed rule-result reporting.
 *
 * @see docs/prd.md §5.1 — The gate
 */

import type { PromotionPolicy, PromotionDecision, JudgeStabilityMatrix } from '@lanefoundry/gatelane-sdk';
import type { CandidateMetric } from '@lanefoundry/gatelane-engine';
import { evaluate, type EvaluateArgs, type EvaluateResult } from '@lanefoundry/gatelane-engine';
import { DEFAULT_POLICY } from '@lanefoundry/gatelane-sdk';

/** Input for promotion decision. */
export type PromotionDecisionArgs = {
  /** Candidate references in evaluation order. */
  candidates: ReadonlyArray<string>;
  /** Per-candidate metrics from compareScores(). */
  perCandidate: Record<string, CandidateMetric>;
  /** Judge stability matrix from compareScores(). */
  judgeMatrix: JudgeStabilityMatrix;
  /** Promotion policy to apply. Defaults to DEFAULT_POLICY. */
  policy?: PromotionPolicy;
  /** Optional approver (required when policy.approval_required = true). */
  approver?: string;
};

/** Result of promotion decision with extended detail. */
export type PromotionDecisionResult = {
  /** The promotion decision. */
  decision: PromotionDecision;
  /** Per-rule pass/fail detail. */
  ruleResults: EvaluateResult['rule_results'];
  /** Policy that was applied. */
  policy: PromotionPolicy;
  /** Whether approval is required. */
  approvalRequired: boolean;
  /** Approver if provided. */
  approver?: string;
};

/**
 * Evaluate candidates against promotion policy.
 *
 * This wraps the engine's evaluate() and adds:
 * - Input validation
 * - Policy merge with defaults
 * - Extended result with policy and approval metadata
 */
export function makePromotionDecision(args: PromotionDecisionArgs): PromotionDecisionResult {
  const { candidates, perCandidate, judgeMatrix, policy = DEFAULT_POLICY, approver } = args;

  // Validate inputs
  if (candidates.length === 0) {
    throw new Error('promotion-decision: at least one candidate is required');
  }
  for (const ref of candidates) {
    if (!perCandidate[ref]) {
      throw new Error(`promotion-decision: missing metrics for candidate "${ref}"`);
    }
  }

  // Evaluate using engine
  const evaluateArgs: EvaluateArgs = {
    candidates,
    perCandidate,
    judgeMatrix,
    policy,
    approver,
  };

  const result = evaluate(evaluateArgs);

  return {
    decision: result.decision,
    ruleResults: result.rule_results,
    policy,
    approvalRequired: policy.approval_required,
    approver,
  };
}

/**
 * Check if a candidate passes all policy rules without making a final decision.
 * Returns per-rule results for inspection.
 */
export function checkCandidateAgainstPolicy(
  candidateRef: string,
  metric: CandidateMetric,
  judgeMatrix: JudgeStabilityMatrix,
  policy: PromotionPolicy = DEFAULT_POLICY,
): {
  passes: boolean;
  rules: Record<string, { pass: boolean; value: number; threshold: number }>;
} {
  const consensus = new Set(judgeMatrix.consensus_winners);
  const isConsensus = consensus.has(candidateRef);

  const rules = {
    min_delta: {
      pass: metric.aggregate_delta >= policy.min_delta,
      value: metric.aggregate_delta,
      threshold: policy.min_delta,
    },
    judge_stability: {
      pass: isConsensus,
      value: isConsensus ? 1 : 0,
      threshold: policy.judge_stability_threshold,
    },
    cost_ceiling: {
      pass: metric.cost_delta <= policy.cost_ceiling,
      value: metric.cost_delta,
      threshold: policy.cost_ceiling,
    },
    latency_ceiling: {
      pass: metric.latency_delta <= policy.latency_ceiling,
      value: metric.latency_delta,
      threshold: policy.latency_ceiling,
    },
  };

  const passes = Object.values(rules).every((r) => r.pass);

  return { passes, rules };
}

/**
 * Validate a PromotionPolicy for correctness.
 * Throws if policy has invalid values.
 */
export function validatePolicy(policy: PromotionPolicy): void {
  if (policy.min_delta < 0 || policy.min_delta > 1) {
    throw new Error('policy.min_delta must be in [0, 1]');
  }
  if (policy.judge_stability_threshold < 0 || policy.judge_stability_threshold > 1) {
    throw new Error('policy.judge_stability_threshold must be in [0, 1]');
  }
  if (policy.cost_ceiling < 0) {
    throw new Error('policy.cost_ceiling must be >= 0');
  }
  if (policy.latency_ceiling < 0) {
    throw new Error('policy.latency_ceiling must be >= 0');
  }
  if (policy.auto_rollback_rule !== undefined) {
    if (policy.auto_rollback_rule.metric_drop < 0 || policy.auto_rollback_rule.metric_drop > 1) {
      throw new Error('policy.auto_rollback_rule.metric_drop must be in [0, 1]');
    }
    if (!policy.auto_rollback_rule.window || typeof policy.auto_rollback_rule.window !== 'string') {
      throw new Error('policy.auto_rollback_rule.window must be a non-empty string (e.g., "24h")');
    }
  }
}