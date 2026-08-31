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
import { type EvaluateResult } from '@lanefoundry/gatelane-engine';
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
export declare function makePromotionDecision(args: PromotionDecisionArgs): PromotionDecisionResult;
/**
 * Check if a candidate passes all policy rules without making a final decision.
 * Returns per-rule results for inspection.
 */
export declare function checkCandidateAgainstPolicy(candidateRef: string, metric: CandidateMetric, judgeMatrix: JudgeStabilityMatrix, policy?: PromotionPolicy): {
    passes: boolean;
    rules: Record<string, {
        pass: boolean;
        value: number;
        threshold: number;
    }>;
};
/**
 * Validate a PromotionPolicy for correctness.
 * Throws if policy has invalid values.
 */
export declare function validatePolicy(policy: PromotionPolicy): void;
//# sourceMappingURL=promotion-decision.d.ts.map