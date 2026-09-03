import type { PromotionReport, Env } from "@gatelane/shared";
import { freezeSlice } from "@gatelane/engine";
import { replay } from "@gatelane/engine";
import { evaluatePromotion } from "@gatelane/engine";
import { writeAuditLog } from "@gatelane/engine";

export async function backtest(
  env: Env,
  opts: {
    window: string;
    candidateModel: string;
    baselineModel: string;
    threshold: number;
    judge: (prompt: unknown, response: unknown) => Promise<number>;
    execute: (prompt: unknown, model: string) => Promise<unknown>;
  },
): Promise<PromotionReport> {
  const windowMs = parseWindow(opts.window);
  const now = new Date();
  const windowStart = new Date(now.getTime() - windowMs).toISOString();
  const windowEnd = now.toISOString();

  const dataset = await freezeSlice(env, {
    name: `backtest-${now.toISOString()}`,
    windowStart,
    windowEnd,
    description: `Auto-frozen for backtest: ${opts.baselineModel} → ${opts.candidateModel}`,
  });

  await writeAuditLog(env, {
    action: "freeze",
    resourceType: "dataset",
    resourceId: dataset.id,
    actor: "system",
    detail: { window: opts.window, itemCount: dataset.itemCount },
  });

  const run = await replay(env, {
    datasetId: dataset.id,
    candidateModel: opts.candidateModel,
    baselineModel: opts.baselineModel,
    judge: opts.judge,
    execute: opts.execute,
  });

  await writeAuditLog(env, {
    action: "replay",
    resourceType: "replay_run",
    resourceId: run.id,
    actor: "system",
    detail: { status: run.status },
  });

  const report = await evaluatePromotion(env, {
    replayRunId: run.id,
    threshold: opts.threshold,
    candidateModel: opts.candidateModel,
    baselineModel: opts.baselineModel,
  });

  await writeAuditLog(env, {
    action: report.decision === "promote" ? "promote" : "rollback",
    resourceType: "promotion",
    resourceId: report.id,
    actor: "system",
    detail: { delta: report.delta, threshold: report.threshold, decision: report.decision },
  });

  return report;
}

function parseWindow(window: string): number {
  const match = window.match(/^(\d+)(m|h|d)$/);
  if (!match) throw new Error(`Invalid window format: ${window}. Use e.g. "7d", "24h", "30m"`);
  const value = parseInt(match[1], 10);
  const unit = match[2];
  const multipliers: Record<string, number> = { m: 60_000, h: 3_600_000, d: 86_400_000 };
  return value * multipliers[unit];
}
