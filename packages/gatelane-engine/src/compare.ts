/**
 * Compare — fold replay results + judge verdicts into per-candidate metrics
 * and the judge stability matrix that drives the promotion decision.
 *
 * @see docs/prd.md §5.1 — The gate
 */

import type { JudgeStabilityMatrix } from '@lanefoundry/gatelane-sdk/promotion';

import type { ReplayResult } from './replay.js';
import type { JudgeVerdict } from './judge.js';

/** Per-candidate summary consumed by PromotionReport. */
export type CandidateMetric = {
  /** Mean of judge scores, 0.0–1.0. */
  mean_score: number;
  /** Fraction of items the candidate survived (judge passed). */
  pass_rate: number;
  /** Items evaluated. */
  n_items: number;
  /** Total cost across all items. */
  total_cost_usd: number;
  /** Mean latency per item, ms. */
  mean_latency_ms: number;
  /** Δ vs baseline on mean_score (baseline = 0). */
  aggregate_delta: number;
  /** Δ vs baseline on cost. */
  cost_delta: number;
  /** Δ vs baseline on mean latency. */
  latency_delta: number;
};

export type CompareArgs = {
  replay: ReplayResult;
  verdicts: ReadonlyArray<JudgeVerdict>;
  baseline_ref?: string;
};

/**
 * Group verdicts by (candidate_ref, judge_ref). For each candidate compute:
 *   mean_score (across items, across judges)
 *   pass_rate (across items, across judges)
 *   cost / latency aggregates from replay rows
 *   Δ vs baseline (baseline treated as 0; only meaningful if baseline included).
 */
export function compare(args: CompareArgs): {
  perCandidate: Record<string, CandidateMetric>;
  judgeMatrix: JudgeStabilityMatrix;
} {
  const baselineRef = args.baseline_ref;

  // Per (candidate, judge): mean_score + pass_rate.
  const byCJ = new Map<string, JudgeVerdict[]>();
  const candidates = new Set<string>();
  const judges = new Set<string>();
  for (const v of args.verdicts) {
    const k = `${v.candidate_ref}|${v.judge_ref}`;
    const list = byCJ.get(k) ?? [];
    list.push(v);
    byCJ.set(k, list);
    candidates.add(v.candidate_ref);
    judges.add(v.judge_ref);
  }

  // Per candidate: aggregate across judges (equal weight).
  const perCandidate: Record<string, CandidateMetric> = {};
  for (const cand of candidates) {
    let scoreSum = 0;
    let scoreN = 0;
    let pass = 0;
    let total = 0;
    for (const j of judges) {
      const list = byCJ.get(`${cand}|${j}`) ?? [];
      for (const v of list) {
        scoreSum += v.score;
        scoreN += 1;
        total += 1;
        if (v.outcome === 'pass') pass += 1;
      }
    }
    const mean_score = scoreN === 0 ? 0 : scoreSum / scoreN;
    const pass_rate = total === 0 ? 0 : pass / total;

    // Cost / latency from replay rows.
    const candRows = args.replay.rows.filter((r) => r.candidate_ref === cand);
    const total_cost_usd = candRows.reduce((a, r) => a + r.response.cost_usd, 0);
    const mean_latency_ms = candRows.length === 0
      ? 0
      : candRows.reduce((a, r) => a + r.response.latency_ms, 0) / candRows.length;

    perCandidate[cand] = {
      mean_score,
      pass_rate,
      n_items: candRows.length,
      total_cost_usd,
      mean_latency_ms,
      aggregate_delta: 0, // overwritten below if baseline exists
      cost_delta: 0,
      latency_delta: 0,
    };
  }

  if (baselineRef !== undefined && perCandidate[baselineRef] !== undefined) {
    const baseline = perCandidate[baselineRef];
    if (baseline !== undefined) {
      for (const cand of Object.keys(perCandidate)) {
        const m = perCandidate[cand];
        if (m === undefined) continue;
        perCandidate[cand] = {
          ...m,
          aggregate_delta: m.mean_score - baseline.mean_score,
          cost_delta: m.total_cost_usd - baseline.total_cost_usd,
          latency_delta: m.mean_latency_ms - baseline.mean_latency_ms,
        };
      }
    }
  }

  // Judge stability matrix: per judge, which candidate wins?
  const winnersByJudge: Record<string, number> = {};
  const consensusWinners: string[] = [];
  for (const j of judges) {
    let best: { ref: string; mean_score: number } | null = null;
    for (const cand of candidates) {
      const list = byCJ.get(`${cand}|${j}`) ?? [];
      const mean = list.length === 0 ? 0 : list.reduce((a, v) => a + v.score, 0) / list.length;
      if (best === null || mean > best.mean_score) {
        best = { ref: cand, mean_score: mean };
      }
    }
    if (best !== null) {
      winnersByJudge[best.ref] = (winnersByJudge[best.ref] ?? 0) + 1;
    }
  }
  // consensus = a candidate is consensus if it wins in ≥ threshold fraction of judges.
  const threshold = 0.5; // compared against judge_stability_threshold in promotion policy
  const minVotes = Math.ceil(judges.size * threshold);
  for (const cand of Object.keys(winnersByJudge)) {
    if ((winnersByJudge[cand] ?? 0) >= minVotes) consensusWinners.push(cand);
  }
  if (consensusWinners.length === 0) {
    // Fall back: any candidate with at least one win is in consensus.
    for (const cand of Object.keys(winnersByJudge)) {
      if ((winnersByJudge[cand] ?? 0) >= 1) consensusWinners.push(cand);
    }
  }

  const judgeMatrix: JudgeStabilityMatrix = {
    candidates: [...candidates],
    judges: [...judges],
    winners_by_judge: winnersByJudge,
    consensus_winners: consensusWinners,
  };

  return { perCandidate, judgeMatrix };
}