import type { TracingSession, Trace, Env } from "@gatelane/shared";

export interface CreateSessionOpts {
  name: string;
  metadata?: Record<string, unknown>;
}

export async function createSession(
  env: Env,
  opts: CreateSessionOpts,
): Promise<TracingSession> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const session: TracingSession = {
    id,
    name: opts.name,
    metadata: opts.metadata ?? {},
    createdAt: now,
  };

  await env.DB.prepare(
    `INSERT INTO tracing_sessions (id, name, metadata, created_at)
     VALUES (?, ?, ?, ?)`,
  )
    .bind(session.id, session.name, JSON.stringify(session.metadata), session.createdAt)
    .run();

  return session;
}

export async function getSession(
  env: Env,
  sessionId: string,
): Promise<TracingSession & { traces: Trace[] }> {
  const row = await env.DB.prepare(
    `SELECT id, name, metadata, created_at FROM tracing_sessions WHERE id = ?`,
  )
    .bind(sessionId)
    .first<{
      id: string;
      name: string;
      metadata: string;
      created_at: string;
    }>();

  if (!row) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const traceRows = await env.DB.prepare(
    `SELECT id, name, start_time, end_time, status, input, output, metadata, user_id, session_id, created_at
     FROM traces WHERE session_id = ? ORDER BY created_at`,
  )
    .bind(sessionId)
    .all<{
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

  const traces: Trace[] = (traceRows.results ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    startTime: r.start_time,
    endTime: r.end_time,
    status: r.status as Trace["status"],
    input: JSON.parse(r.input),
    output: r.output ? JSON.parse(r.output) : null,
    metadata: JSON.parse(r.metadata),
    userId: r.user_id,
    sessionId: r.session_id,
    createdAt: r.created_at,
  }));

  return {
    id: row.id,
    name: row.name,
    metadata: JSON.parse(row.metadata),
    createdAt: row.created_at,
    traces,
  };
}
