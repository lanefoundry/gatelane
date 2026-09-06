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
import { compare, type CandidateMetric } from '@lanefoundry/gatelane-engine';

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
export function compareScores(args: CompareScoresArgs): CompareScoresResult {
  const { replayResults, verdicts, baselineRef } = args;

  // Build a combined ReplayResult from per-candidate results
  const allRows: ReplayRow[] = [];
  let totalCostUsd = 0;
  let totalLatencyMs = 0;
  const candidates: ReadonlyArray<string> = Object.keys(replayResults);

  for (const [candidateRef, result] of Object.entries(replayResults)) {
    // Tag each row with its candidate_ref for compare()
    for (const row of result.rows) {
      allRows.push({ ...row, candidate_ref: candidateRef });
    }
    totalCostUsd += result.total_cost_usd;
    totalLatencyMs += result.total_latency_ms;
  }

  const combinedReplay: ReplayResult = {
    rows: allRows,
    determinism_score: candidates.length > 0
      ? Object.values(replayResults).reduce((sum, r) => sum + r.determinism_score, 0) / candidates.length
      : 0,
    total_cost_usd: totalCostUsd,
    total_latency_ms: totalLatencyMs,
  };

  // Run engine compare
  const { perCandidate, judgeMatrix } = compare({
    replay: combinedReplay,
    verdicts,
    baseline_ref: baselineRef,
  });

  // Build summary
  const candidateMetrics = Object.entries(perCandidate);
  let bestCandidate = '';
  let bestDelta = -Infinity;
  for (const [ref, metric] of candidateMetrics) {
    if (metric.aggregate_delta > bestDelta) {
      bestDelta = metric.aggregate_delta;
      bestCandidate = ref;
    }
  }
  const bestAggregateDelta = bestCandidate ? bestDelta : 0;

  return {
    perCandidate,
    judgeMatrix,
    summary: {
      candidates,
      bestCandidate,
      bestAggregateDelta,
      consensusWinners: judgeMatrix.consensus_winners,
    },
  };
}

/**
 * Compare scores for a single candidate against existing baseline.
 * Useful for incremental gate runs.
 */
export function compareSingle(
  replayResults: Record<string, ReplayResult>,
  verdicts: ReadonlyArray<JudgeVerdict>,
  candidateRef: string,
  baselineRef?: string,
): CandidateMetric {
  const result = compareScores({ replayResults, verdicts, baselineRef });
  const metric = result.perCandidate[candidateRef];
  if (!metric) {
    throw new Error(`Candidate not found: ${candidateRef}`);
  }
  return metric;
}

/**
 * Compute judge stability matrix directly from verdicts (without replay data).
 * Useful for analyzing judge agreement in isolation.
 */
export function computeJudgeStability(
  verdicts: ReadonlyArray<JudgeVerdict>,
  candidates: ReadonlyArray<string>,
  judgeStabilityThreshold: number,
): JudgeStabilityMatrix {
  const judges = Array.from(new Set(verdicts.map((v) => v.judge_ref))).sort();

  // winners_by_judge[candidate] = count of judges that picked this candidate as winner
  const winners_by_judge: Record<string, number> = {};
  for (const candidate of candidates) {
    winners_by_judge[candidate] = 0;
  }

  // For each judge, determine their top candidate
  for (const judge of judges) {
    const judgeVerdicts = verdicts.filter((v) => v.judge_ref === judge);
    if (judgeVerdicts.length === 0) continue;

    // Average score per candidate for this judge
    const scores: Record<string, { sum: number; count: number }> = {};
    for (const v of judgeVerdicts) {
      const existing = scores[v.candidate_ref] ?? { sum: 0, count: 0 };
      existing.sum += v.score;
      existing.count += 1;
      scores[v.candidate_ref] = existing;
    }

    let bestRef = '';
    let bestScore = -1;
    for (const [ref, { sum, count }] of Object.entries(scores)) {
      const avg = sum / count;
      if (avg > bestScore) {
        bestScore = avg;
        bestRef = ref;
      }
    }

    if (bestRef) {
      winners_by_judge[bestRef] = (winners_by_judge[bestRef] ?? 0) + 1;
    }
  }

  // Consensus winners: candidates winning under >= threshold * judges.length judges
  const minWins = Math.ceil(judgeStabilityThreshold * judges.length);
  const consensus_winners = Object.entries(winners_by_judge)
    .filter(([, wins]) => wins >= minWins)
    .map(([ref]) => ref)
    .sort();

  return {
    candidates,
    judges,
    winners_by_judge,
    consensus_winners,
  };
}