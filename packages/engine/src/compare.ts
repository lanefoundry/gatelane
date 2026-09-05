import type { PromotionSummary, Env } from "@gatelane/shared";

export async function compare(
  env: Env,
  replayRunId: string,
): Promise<PromotionSummary> {
  const results = await env.DB.prepare(
    `SELECT candidate_score, baseline_score, candidate_cost_cents, candidate_latency_ms
     FROM replay_results WHERE replay_run_id = ?`,
  )
    .bind(replayRunId)
    .all<{
      candidate_score: number;
      baseline_score: number;
      candidate_cost_cents: number;
      candidate_latency_ms: number;
    }>();

  const rows = results.results ?? [];
  if (rows.length === 0) {
    return {
      totalItems: 0,
      candidateAvgScore: 0,
      baselineAvgScore: 0,
      candidateAvgCostCents: 0,
      baselineAvgCostCents: 0,
      candidateAvgLatencyMs: 0,
      baselineAvgLatencyMs: 0,
      regressionCount: 0,
    };
  }

  const total = rows.length;
  let candidateScoreSum = 0;
  let baselineScoreSum = 0;
  let candidateCostSum = 0;
  let candidateLatencySum = 0;
  let regressionCount = 0;

  for (const row of rows) {
    candidateScoreSum += row.candidate_score;
    baselineScoreSum += row.baseline_score;
    candidateCostSum += row.candidate_cost_cents;
    candidateLatencySum += row.candidate_latency_ms;
    if (row.candidate_score < row.baseline_score) {
      regressionCount++;
    }
  }

  const baseline = await env.DB.prepare(
    `SELECT c.cost_cents, c.latency_ms
     FROM replay_results rr
     JOIN dataset_items di ON di.id = rr.dataset_item_id
     JOIN captures c ON c.id = di.capture_id
     WHERE rr.replay_run_id = ?`,
  )
    .bind(replayRunId)
    .all<{ cost_cents: number; latency_ms: number }>();

  const baselineRows = baseline.results ?? [];
  let baselineCostSum = 0;
  let baselineLatencySum = 0;
  for (const row of baselineRows) {
    baselineCostSum += row.cost_cents;
    baselineLatencySum += row.latency_ms;
  }

  return {
    totalItems: total,
    candidateAvgScore: candidateScoreSum / total,
    baselineAvgScore: baselineScoreSum / total,
    candidateAvgCostCents: candidateCostSum / total,
    baselineAvgCostCents: baselineCostSum / total,
    candidateAvgLatencyMs: candidateLatencySum / total,
    baselineAvgLatencyMs: baselineLatencySum / total,
    regressionCount,
  };
}
