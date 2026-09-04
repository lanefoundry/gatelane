import type { Env } from "@gatelane/shared";
import type { MetricName, MetricResult, JudgeFn } from "./types.js";

export async function score(
  _env: Env,
  opts: {
    metric: MetricName;
    input: unknown;
    output: unknown;
    expected?: unknown;
    judge: JudgeFn;
    threshold?: number;
  },
): Promise<MetricResult> {
  const threshold = opts.threshold ?? 0.7;
  const value = await opts.judge(opts.input, opts.output, opts.expected);

  return {
    metric: opts.metric,
    score: value,
    passed: value >= threshold,
    threshold,
  };
}
