import type { Env } from "@gatelane/shared";
import type { MetricName, MetricResult, JudgeFn } from "./types.js";
import { getMetricPrompt } from "./metrics/index.js";

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
  const prompt = getMetricPrompt(opts.metric);

  let judgeInput = opts.input;
  if (prompt) {
    judgeInput = {
      system: prompt.system,
      user: prompt.buildUser(opts.input, opts.output, opts.expected),
    };
  }

  const value = await opts.judge(judgeInput, opts.output, opts.expected);

  return {
    metric: opts.metric,
    score: value,
    passed: value >= threshold,
    threshold,
  };
}
