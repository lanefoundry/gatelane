import type { PromotionReport, Env } from "@gatelane/shared";
import { compare } from "./compare.js";

export async function evaluatePromotion(
  env: Env,
  opts: {
    replayRunId: string;
    threshold: number;
    candidateModel: string;
    baselineModel: string;
  },
): Promise<PromotionReport> {
  const summary = await compare(env, opts.replayRunId);
  const delta = summary.candidateAvgScore - summary.baselineAvgScore;
  const decision = delta >= opts.threshold ? "promote" : "rollback";

  const id = crypto.randomUUID();
  const signature = await sign(id, delta, decision);
  const createdAt = new Date().toISOString();

  const report: PromotionReport = {
    id,
    replayRunId: opts.replayRunId,
    delta,
    threshold: opts.threshold,
    decision,
    candidateModel: opts.candidateModel,
    baselineModel: opts.baselineModel,
    summary,
    signature,
    createdAt,
  };

  await env.DB.prepare(
    `INSERT INTO promotions (id, replay_run_id, delta, threshold, decision, candidate_model, baseline_model, summary, signature, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(report.id, report.replayRunId, report.delta, report.threshold, report.decision, report.candidateModel, report.baselineModel, JSON.stringify(report.summary), report.signature, report.createdAt)
    .run();

  return report;
}

async function sign(id: string, delta: number, decision: string): Promise<string> {
  const payload = `${id}:${delta}:${decision}`;
  const encoder = new TextEncoder();
  const data = encoder.encode(payload);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}
