/**
 * compare-scores.ts — Compute Δ vs baseline + judge stability matrix.
 *
 * Reuses engine's compare() and judge aggregation to produce per-candidate
 * metrics and the judge stability matrix used for promotion decisions.
 *
 * @see docs/prd.md §5.1 — The gate
 */
import type { JudgeStabilityMatrix } from '@lanefoundry/gatelane-sdk';
import type { ReplayResult } from '@lanefoundry/gatelane-engine';
import type { JudgeVerdict } from '@lanefoundry/gatelane-engine';
import { type CandidateMetric } from '@lanefoundry/gatelane-engine';
/** Input for score comparison. */
export type CompareScoresArgs = {
    /** Replay results from replayBatch(). */
    replayResults: Record<string, ReplayResult>;
    /** Judge verdicts (from LLMJudge or mock). */
    verdicts: ReadonlyArray<JudgeVerdict>;
    /** Baseline candidate ref (optional; if absent, baseline metrics = 0). */
    baselineRef?: string;
};
/** Output of score comparison. */
export type CompareScoresResult = {
    /** Per-candidate metrics with deltas vs baseline. */
    perCandidate: Record<string, CandidateMetric>;
    /** Judge stability matrix showing consensus winners. */
    judgeMatrix: JudgeStabilityMatrix;
    /** Summary for quick inspection. */
    summary: {
        candidates: ReadonlyArray<string>;
        bestCandidate: string;
        bestAggregateDelta: number;
        consensusWinners: ReadonlyArray<string>;
    };
};
/**
 * Compare replay results against judge verdicts to compute metrics and stability.
 *
 * This wraps the engine's compare() and adds:
 * - Input from replayBatch() output format (per-candidate ReplayResult)
 * - Flattened per-candidate verdict aggregation
 * - Summary with best candidate identification
 */
export declare function compareScores(args: CompareScoresArgs): CompareScoresResult;
/**
 * Compare scores for a single candidate against existing baseline.
 * Useful for incremental gate runs.
 */
export declare function compareSingle(replayResults: Record<string, ReplayResult>, verdicts: ReadonlyArray<JudgeVerdict>, candidateRef: string, baselineRef?: string): CandidateMetric;
/**
 * Compute judge stability matrix directly from verdicts (without replay data).
 * Useful for analyzing judge agreement in isolation.
 */
export declare function computeJudgeStability(verdicts: ReadonlyArray<JudgeVerdict>, candidates: ReadonlyArray<string>, judgeStabilityThreshold: number): JudgeStabilityMatrix;
//# sourceMappingURL=compare-scores.d.ts.map