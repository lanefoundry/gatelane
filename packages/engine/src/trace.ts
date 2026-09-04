import type { Trace, Env } from "@gatelane/shared";

export interface CreateTraceOpts {
  name: string;
  input?: unknown;
  metadata?: Record<string, unknown>;
  userId?: string;
  sessionId?: string;
}

export async function createTrace(
  env: Env,
  opts: CreateTraceOpts,
): Promise<Trace> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const trace: Trace = {
    id,
    name: opts.name,
    startTime: now,
    endTime: null,
    status: "running",
    input: opts.input ?? null,
    output: null,
    metadata: opts.metadata ?? {},
    userId: opts.userId ?? null,
    sessionId: opts.sessionId ?? null,
    createdAt: now,
  };

  await env.DB.prepare(
    `INSERT INTO traces (id, name, start_time, end_time, status, input, output, metadata, user_id, session_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      trace.id,
      trace.name,
      trace.startTime,
      trace.endTime,
      trace.status,
      JSON.stringify(trace.input),
      JSON.stringify(trace.output),
      JSON.stringify(trace.metadata),
      trace.userId,
      trace.sessionId,
      trace.createdAt,
    )
    .run();

  return trace;
}

export async function endTrace(
  env: Env,
  traceId: string,
  status: "completed" | "error",
  output?: unknown,
): Promise<Trace> {
  const endTime = new Date().toISOString();

  await env.DB.prepare(
    `UPDATE traces SET end_time = ?, status = ?, output = ? WHERE id = ?`,
  )
    .bind(endTime, status, output !== undefined ? JSON.stringify(output) : null, traceId)
    .run();

  return getTrace(env, traceId);
}

export async function getTrace(
  env: Env,
  traceId: string,
): Promise<Trace> {
  const row = await env.DB.prepare(
    `SELECT id, name, start_time, end_time, status, input, output, metadata, user_id, session_id, created_at
     FROM traces WHERE id = ?`,
  )
    .bind(traceId)
    .first<{
      id: string;
      name: string;
      start_time: string;
      end_time: string | null;
      status: string;
      input: string;
      output: string | null;
      metadata: string;
      user_id: string | null;
      session_id: string | null;
      created_at: string;
    }>();

  if (!row) {
    throw new Error(`Trace not found: ${traceId}`);
  }

  return {
    id: row.id,
    name: row.name,
    startTime: row.start_time,
    endTime: row.end_time,
    status: row.status as Trace["status"],
    input: JSON.parse(row.input),
    output: row.output ? JSON.parse(row.output) : null,
    metadata: JSON.parse(row.metadata),
    userId: row.user_id,
    sessionId: row.session_id,
    createdAt: row.created_at,
  };
}
