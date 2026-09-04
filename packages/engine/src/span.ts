import type { Span, Env } from "@gatelane/shared";

export interface CreateSpanOpts {
  traceId: string;
  name: string;
  parentSpanId?: string;
  input?: unknown;
  metadata?: Record<string, unknown>;
}

export async function createSpan(
  env: Env,
  opts: CreateSpanOpts,
): Promise<Span> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const span: Span = {
    id,
    traceId: opts.traceId,
    parentSpanId: opts.parentSpanId ?? null,
    name: opts.name,
    startTime: now,
    endTime: null,
    input: opts.input ?? null,
    output: null,
    metadata: opts.metadata ?? {},
    createdAt: now,
  };

  await env.DB.prepare(
    `INSERT INTO spans (id, trace_id, parent_span_id, name, start_time, end_time, input, output, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      span.id,
      span.traceId,
      span.parentSpanId,
      span.name,
      span.startTime,
      span.endTime,
      JSON.stringify(span.input),
      JSON.stringify(span.output),
      JSON.stringify(span.metadata),
      span.createdAt,
    )
    .run();

  return span;
}

export async function endSpan(
  env: Env,
  spanId: string,
  output?: unknown,
): Promise<Span> {
  const endTime = new Date().toISOString();

  await env.DB.prepare(
    `UPDATE spans SET end_time = ?, output = ? WHERE id = ?`,
  )
    .bind(endTime, output !== undefined ? JSON.stringify(output) : null, spanId)
    .run();

  const row = await env.DB.prepare(
    `SELECT id, trace_id, parent_span_id, name, start_time, end_time, input, output, metadata, created_at
     FROM spans WHERE id = ?`,
  )
    .bind(spanId)
    .first<{
      id: string;
      trace_id: string;
      parent_span_id: string | null;
      name: string;
      start_time: string;
      end_time: string | null;
      input: string;
      output: string | null;
      metadata: string;
      created_at: string;
    }>();

  if (!row) {
    throw new Error(`Span not found: ${spanId}`);
  }

  return {
    id: row.id,
    traceId: row.trace_id,
    parentSpanId: row.parent_span_id,
    name: row.name,
    startTime: row.start_time,
    endTime: row.end_time,
    input: JSON.parse(row.input),
    output: row.output ? JSON.parse(row.output) : null,
    metadata: JSON.parse(row.metadata),
    createdAt: row.created_at,
  };
}
