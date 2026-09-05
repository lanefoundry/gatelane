import type { ReplayRun, Env } from "@gatelane/shared";

export async function replay(
  env: Env,
  opts: {
    datasetId: string;
    candidateModel: string;
    baselineModel: string;
    judge: (prompt: unknown, response: unknown) => Promise<number>;
    execute: (prompt: unknown, model: string) => Promise<unknown>;
  },
): Promise<ReplayRun> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const run: ReplayRun = {
    id,
    datasetId: opts.datasetId,
    candidateModel: opts.candidateModel,
    baselineModel: opts.baselineModel,
    status: "running",
    startedAt: now,
    completedAt: null,
    createdAt: now,
  };

  await env.DB.prepare(
    `INSERT INTO replay_runs (id, dataset_id, candidate_model, baseline_model, status, started_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(run.id, run.datasetId, run.candidateModel, run.baselineModel, run.status, run.startedAt, run.createdAt)
    .run();

  try {
    const items = await env.DB.prepare(
      `SELECT di.id as item_id, c.prompt, c.response as baseline_response
       FROM dataset_items di
       JOIN captures c ON c.id = di.capture_id
       WHERE di.dataset_id = ?
       ORDER BY di.ordinal`,
    )
      .bind(opts.datasetId)
      .all<{ item_id: string; prompt: string; baseline_response: string }>();

    for (const item of items.results ?? []) {
      const prompt = JSON.parse(item.prompt);
      const start = Date.now();
      const candidateResponse = await opts.execute(prompt, opts.candidateModel);
      const candidateLatencyMs = Date.now() - start;

      const [candidateScore, baselineScore] = await Promise.all([
        opts.judge(prompt, candidateResponse),
        opts.judge(prompt, JSON.parse(item.baseline_response)),
      ]);

      const resultId = crypto.randomUUID();
      await env.DB.prepare(
        `INSERT INTO replay_results (id, replay_run_id, dataset_item_id, candidate_response, baseline_response, candidate_score, baseline_score, candidate_cost_cents, candidate_latency_ms, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(resultId, run.id, item.item_id, JSON.stringify(candidateResponse), item.baseline_response, candidateScore, baselineScore, 0, candidateLatencyMs, new Date().toISOString())
        .run();
    }

    run.status = "completed";
    run.completedAt = new Date().toISOString();
  } catch {
    run.status = "failed";
    run.completedAt = new Date().toISOString();
  }

  await env.DB.prepare(
    `UPDATE replay_runs SET status = ?, completed_at = ? WHERE id = ?`,
  )
    .bind(run.status, run.completedAt, run.id)
    .run();

  return run;
}
