import { Hono } from "hono";
import type { Env } from "@gatelane/shared";

export const replayApi = new Hono<{ Bindings: Env }>();

/** Parse a D1 captures row back into the wire CaptureRecord shape. */
function rowToCapture(row: Record<string, unknown>): Record<string, unknown> {
  const json = (v: unknown, fallback: unknown) => {
    if (typeof v !== "string") return v ?? fallback;
    try { return JSON.parse(v); } catch { return fallback; }
  };
  return {
    id: row.id,
    traceId: row.trace_id,
    prompt: json(row.prompt, []),
    response: json(row.response, null),
    model: row.model,
    provider: row.provider,
    costCents: row.cost_cents,
    latencyMs: row.latency_ms,
    metadata: json(row.metadata, {}),
    createdAt: row.created_at,
  };
}

replayApi.get("/captures", async (c) => {
  const since = c.req.query("since");
  const model = c.req.query("model");
  const limit = Math.min(Number(c.req.query("limit") ?? 100), 1000);

  let sql = "SELECT * FROM captures";
  const params: string[] = [];
  const clauses: string[] = [];
  if (since !== undefined) {
    clauses.push("created_at >= ?");
    params.push(since);
  }
  if (model !== undefined) {
    clauses.push("model = ?");
    params.push(model);
  }
  if (clauses.length > 0) sql += " WHERE " + clauses.join(" AND ");
  sql += " ORDER BY created_at DESC LIMIT ?";
  params.push(String(limit));

  const { results } = await c.env.DB.prepare(sql).bind(...params).all();
  return c.json({ captures: results.map((row) => rowToCapture(row as Record<string, unknown>)) });
});

replayApi.get("/datasets/:id", async (c) => {
  const id = c.req.param("id");
  const dataset = await c.env.DB.prepare("SELECT * FROM datasets WHERE id = ?").bind(id).first();
  if (!dataset) return c.json({ error: "not found" }, 404);
  return c.json(dataset);
});

replayApi.get("/replay-runs", async (c) => {
  const result = await c.env.DB.prepare(
    "SELECT * FROM replay_runs ORDER BY created_at DESC LIMIT 50",
  ).all();
  return c.json({ runs: result.results });
});

replayApi.get("/replay-runs/:id", async (c) => {
  const id = c.req.param("id");
  const run = await c.env.DB.prepare("SELECT * FROM replay_runs WHERE id = ?").bind(id).first();
  if (!run) return c.json({ error: "not found" }, 404);
  return c.json(run);
});

replayApi.get("/promotions", async (c) => {
  const result = await c.env.DB.prepare(
    "SELECT * FROM promotions ORDER BY created_at DESC LIMIT 50",
  ).all();
  return c.json({ promotions: result.results });
});

replayApi.get("/promotions/:id", async (c) => {
  const id = c.req.param("id");
  const promotion = await c.env.DB.prepare("SELECT * FROM promotions WHERE id = ?").bind(id).first();
  if (!promotion) return c.json({ error: "not found" }, 404);
  return c.json(promotion);
});

replayApi.get("/audit-log", async (c) => {
  const result = await c.env.DB.prepare(
    "SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 100",
  ).all();
  return c.json({ entries: result.results });
});
