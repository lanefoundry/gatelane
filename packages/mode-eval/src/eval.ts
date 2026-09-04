import type { Env } from "@gatelane/shared";
import { writeAuditLog } from "@gatelane/engine";
import type { TestCase, EvalConfig, EvalResult, EvalSummary } from "./types.js";
import { score } from "./scorer.js";

export async function evaluate(
  env: Env,
  testCases: TestCase[],
  execute: (input: unknown) => Promise<unknown>,
  config: EvalConfig = {},
): Promise<EvalSummary> {
  const start = Date.now();
  const metrics = config.metrics ?? ["correctness"];
  const judge = config.judge;
  if (!judge) throw new Error("EvalConfig.judge is required");

  const results: EvalResult[] = [];

  for (const tc of testCases) {
    const tcStart = Date.now();
    const output = await execute(tc.input);

    const metricResults = await Promise.all(
      metrics.map((metric) =>
        score(env, {
          metric,
          input: tc.input,
          output,
          expected: tc.expectedOutput,
          judge,
          threshold: config.threshold,
        }),
      ),
    );

    const passed = metricResults.every((m) => m.passed);

    results.push({
      id: crypto.randomUUID(),
      testCaseId: tc.id,
      metrics: metricResults,
      passed,
      duration: Date.now() - tcStart,
      createdAt: new Date().toISOString(),
    });
  }

  const summary: EvalSummary = {
    total: results.length,
    passed: results.filter((r) => r.passed).length,
    failed: results.filter((r) => !r.passed).length,
    results,
    duration: Date.now() - start,
  };

  await writeAuditLog(env, {
    action: "eval",
    resourceType: "eval_run",
    resourceId: crypto.randomUUID(),
    actor: "system",
    detail: { total: summary.total, passed: summary.passed, failed: summary.failed },
  });

  return summary;
}
