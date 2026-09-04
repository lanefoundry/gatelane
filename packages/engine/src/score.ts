import type { Score, Env } from "@gatelane/shared";

export interface AttachScoreOpts {
  name: string;
  value: number;
  traceId: string;
  spanId?: string;
  generationId?: string;
  source?: "automated" | "manual";
  metadata?: Record<string, unknown>;
}

export async function attachScore(
  env: Env,
  opts: AttachScoreOpts,
): Promise<Score> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const score: Score = {
    id,
    name: opts.name,
    value: opts.value,
    traceId: opts.traceId,
    spanId: opts.spanId ?? null,
    generationId: opts.generationId ?? null,
    source: opts.source ?? "automated",
    metadata: opts.metadata ?? {},
    createdAt: now,
  };

  await env.DB.prepare(
    `INSERT INTO scores (id, name, value, trace_id, span_id, generation_id, source, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      score.id,
      score.name,
      score.value,
      score.traceId,
      score.spanId,
      score.generationId,
      score.source,
      JSON.stringify(score.metadata),
      score.createdAt,
    )
    .run();

  return score;
}
