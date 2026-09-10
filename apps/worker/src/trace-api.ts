import { Hono } from "hono";
import type { Env } from "@gatelane/shared";

export const traceApi = new Hono<{ Bindings: Env }>();

function requireAuth(c: { req: { header(name: string): string | undefined }; env: Env }): boolean {
  const token = c.req.header("Authorization")?.replace("Bearer ", "");
  return token === c.env.GATELANE_CAPTURE_TOKEN;
}

function inputPreview(input: unknown): string {
  const str = typeof input === "string" ? input : JSON.stringify(input);
  return str.slice(0, 200);
}

traceApi.post("/traces", async (c) => {
  if (!requireAuth(c)) {
    return c.json({ error: "unauthorized" }, 401);
  }

  const trace = await c.req.json<{
    id: string;
    name: string;
    userId?: string;
    sessionId?: string;
    input: unknown;
    scores?: Record<string, number>;
    startTime: string;
    endTime?: string;
    spans: unknown[];
    tags?: string[];
  }>();

  const spanCount = trace.spans?.length ?? 0;
  let generationCount = 0;
  for (const span of trace.spans ?? []) {
    const s = span as { generations?: unknown[] };
    generationCount += s.generations?.length ?? 0;
  }

  await c.env.DB.prepare(
    `INSERT INTO traces (id, name, user_id, session_id, tags, input_preview, scores, started_at, ended_at, span_count, generation_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      trace.id,
      trace.name,
      trace.userId ?? null,
      trace.sessionId ?? null,
      trace.tags ? JSON.stringify(trace.tags) : null,
      inputPreview(trace.input),
      trace.scores ? JSON.stringify(trace.scores) : null,
      trace.startTime,
      trace.endTime ?? null,
      spanCount,
      generationCount,
    )
    .run();

  await c.env.CAPTURES.put(
    `traces/${trace.id}.json`,
    JSON.stringify(trace),
    { httpMetadata: { contentType: "application/json" } },
  );

  return c.json({ id: trace.id, stored_at: new Date().toISOString() }, 201);
});

traceApi.get("/traces", async (c) => {
  const since = c.req.query("since");
  const until = c.req.query("until");
  const name = c.req.query("name");
  const tagsParam = c.req.query("tags");
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 500);

  let sql = "SELECT * FROM traces";
  const params: string[] = [];
  const clauses: string[] = [];

  if (since !== undefined) {
    clauses.push("started_at >= ?");
    params.push(since);
  }
  if (until !== undefined) {
    clauses.push("started_at <= ?");
    params.push(until);
  }
  if (name !== undefined) {
    clauses.push("name = ?");
    params.push(name);
  }

  if (clauses.length > 0) sql += " WHERE " + clauses.join(" AND ");
  sql += " ORDER BY started_at DESC LIMIT ?";
  params.push(String(limit));

  const { results } = await c.env.DB.prepare(sql).bind(...params).all();

  let rows = results as Record<string, unknown>[];

  if (tagsParam) {
    const requiredTags = tagsParam.split(",").map((t) => t.trim());
    rows = rows.filter((row) => {
      const rowTags: string[] = row.tags ? JSON.parse(row.tags as string) : [];
      return requiredTags.every((t) => rowTags.includes(t));
    });
  }

  const traces = await Promise.all(
    rows.map(async (row) => {
      const obj = await c.env.CAPTURES.get(`traces/${row.id}.json`);
      if (!obj) return null;
      const text = await new Response(obj.body).text();
      return JSON.parse(text);
    }),
  );

  return c.json({ traces: traces.filter(Boolean) });
});

traceApi.get("/traces/:id", async (c) => {
  const id = c.req.param("id");

  const obj = await c.env.CAPTURES.get(`traces/${id}.json`);
  if (!obj) return c.json({ error: "not found" }, 404);

  const text = await new Response(obj.body).text();
  return c.json(JSON.parse(text));
});
