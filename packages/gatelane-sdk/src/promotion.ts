/**
 * Promotion policy, report, and decision — the signed artifacts produced by a gate run.
 *
 * @see docs/prd.md §5.1 — The gate
 */

export type PromotionPolicy = {
  /** Minimum aggregate delta over baseline required to promote. */
  readonly min_delta: number;
  /** Minimum fraction of judges that must agree on the winning candidate (e.g., 0.67 = 2 of 3). */
  readonly judge_stability_threshold: number;
  /** Maximum cost increase over baseline permitted for a promote decision. */
  readonly cost_ceiling: number;
  /** Maximum latency increase over baseline permitted for a promote decision. */
  readonly latency_ceiling: number;
  /** Whether human approval is required before the gate decision is executed. */
  readonly approval_required: boolean;
  /** Trigger condition under which a deployed canary is automatically rolled back. */
  readonly auto_rollback_rule?: {
    /** Metric drop threshold (e.g., 0.05 = 5% drop). */
    readonly metric_drop: number;
    /** Window to observe canary before promoting to 100% (e.g., "24h"). */
    readonly window: string;
  };
};

export type JudgeStabilityMatrix = {
  readonly candidates: ReadonlyArray<string>;
  readonly judges: ReadonlyArray<string>;
  /** winners_by_judge[candidate] = count of judges that picked this candidate as winner. */
  readonly winners_by_judge: Record<string, number>;
  /** Candidates that won under at least judge_stability_threshold × judges.length judges. */
  readonly consensus_winners: ReadonlyArray<string>;
};

export type PromotionReport = {
  readonly id: string;
  readonly gate_run_id: string;
  readonly dataset_content_hash: string;
  readonly dataset_version: string;
  /** SHA per candidate, keyed by candidate ref. */
  readonly candidate_shas: Record<string, string>;
  /** SHA per judge, keyed by judge ref. */
  readonly judge_shas: Record<string, string>;
  /** SHA of the scorer / evaluator code. */
  readonly scorer_code_sha: string;
  /** Baseline metrics: per-metric. */
  readonly baseline_metrics: Record<string, number>;
  /** Per-candidate metrics: aggregate delta + cost + latency. */
  readonly candidate_metrics: Record<string, {
    aggregate_delta: number;
    cost_delta: number;
    latency_delta: number;
  }>;
  /** Which judge picked which candidate as winner. */
  readonly judge_matrix: JudgeStabilityMatrix;
  /** Policy that was applied to this gate run. */
  readonly policy: PromotionPolicy;
  /** Who approved the decision (when approval_required = true). */
  readonly approver?: string;
  /** ISO 8601 timestamp of report signing. */
  readonly timestamp: string;
  /** Signature. Stub in v0.0.0-dev. */
  readonly signature: string;
};

export type PromotionDecision =
  | {
      readonly action: 'promote';
      readonly winner: string;
      readonly reason: string;
    }
  | {
      readonly action: 'rollback';
      readonly reason: string;
    }
  | {
      readonly action: 'hold_for_review';
      readonly reason: string;
    };

/** Default promotion policy. */
export const DEFAULT_POLICY: PromotionPolicy = {
  min_delta: 0.02,
  judge_stability_threshold: 0.67,
  cost_ceiling: 0.1,
  latency_ceiling: 0.2,
  approval_required: false,
};