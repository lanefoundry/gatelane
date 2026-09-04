import type { Env } from "@gatelane/shared";
import type { FeatureGateConfig, FeatureReadiness, MetricName } from "./types.js";
import { evaluate } from "./eval.js";
import { assertAll } from "./assertions.js";

export async function checkFeatureReadiness(
  env: Env,
  config: FeatureGateConfig,
): Promise<FeatureReadiness> {
  const blockers: string[] = [];
  const scores: Partial<Record<MetricName, number>> = {};

  const perMetricThreshold = Object.entries(config.thresholds).reduce(
    (lowest, [, v]) => Math.min(lowest, v),
    1,
  );

  const summary = await evaluate(env, config.testCases, config.execute, {
    metrics: config.metrics,
    threshold: perMetricThreshold,
    judge: config.judge,
    concurrency: config.concurrency,
  });

  for (const metric of config.metrics) {
    const metricScores = summary.results.flatMap((r) =>
      r.metrics.filter((m) => m.metric === metric).map((m) => m.score),
    );
    const avg = metricScores.length > 0
      ? metricScores.reduce((a, b) => a + b, 0) / metricScores.length
      : 0;
    scores[metric] = avg;

    const threshold = config.thresholds[metric];
    if (threshold != null && avg < threshold) {
      blockers.push(
        `Metric "${metric}" averaged ${avg.toFixed(3)}, below threshold ${threshold}`,
      );
    }
  }

  if (config.requiredAssertions && config.requiredAssertions.length > 0) {
    for (const result of summary.results) {
      const tc = config.testCases.find((t) => t.id === result.testCaseId);
      if (!tc) continue;

      const output = tc.expectedOutput != null ? String(tc.expectedOutput) : "";
      if (!assertAll(output, config.requiredAssertions)) {
        blockers.push(`Required assertions failed for test case "${tc.id}"`);
      }
    }
  }

  return {
    ready: blockers.length === 0,
    blockers,
    scores,
    timestamp: new Date().toISOString(),
  };
}
