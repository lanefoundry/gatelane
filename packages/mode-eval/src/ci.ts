import type { Env } from "@gatelane/shared";
import type { CIConfig, CIResult, EvalSummary, MetricName } from "./types.js";
import { evaluate } from "./eval.js";
import { formatJSON, formatMarkdown, formatJUnit } from "./formatters.js";

function checkThresholds(
  summary: EvalSummary,
  threshold: number,
  perMetricThresholds?: Partial<Record<MetricName, number>>,
): string[] {
  const reasons: string[] = [];

  const passRate = summary.total > 0 ? summary.passed / summary.total : 0;
  if (passRate < threshold) {
    reasons.push(
      `Overall pass rate ${(passRate * 100).toFixed(1)}% is below threshold ${(threshold * 100).toFixed(1)}%`,
    );
  }

  if (perMetricThresholds) {
    const metricScores = new Map<string, number[]>();
    for (const result of summary.results) {
      for (const m of result.metrics) {
        const arr = metricScores.get(m.metric) ?? [];
        arr.push(m.score);
        metricScores.set(m.metric, arr);
      }
    }

    for (const [metric, minScore] of Object.entries(perMetricThresholds)) {
      if (minScore == null) continue;
      const scores = metricScores.get(metric);
      if (!scores) continue;
      const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
      if (avg < minScore) {
        reasons.push(
          `Metric "${metric}" average score ${avg.toFixed(2)} is below threshold ${minScore.toFixed(2)}`,
        );
      }
    }
  }

  return reasons;
}

export async function runCI(env: Env, config: CIConfig): Promise<CIResult> {
  const summary = await evaluate(env, config.testCases, config.execute, {
    metrics: config.metrics,
    threshold: config.threshold,
    judge: config.judge,
    concurrency: config.concurrency,
  });

  const threshold = config.threshold ?? 1.0;
  const failureReasons = checkThresholds(summary, threshold, config.perMetricThresholds);
  const passed = failureReasons.length === 0;

  const format = config.outputFormat ?? "json";
  let output: string;
  switch (format) {
    case "markdown":
      output = formatMarkdown(summary);
      break;
    case "junit":
      output = formatJUnit(summary);
      break;
    default:
      output = formatJSON(summary);
  }

  return {
    passed,
    summary,
    output,
    exitCode: passed ? 0 : 1,
    failureReasons,
  };
}
