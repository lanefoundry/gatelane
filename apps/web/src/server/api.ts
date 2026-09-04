import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "@gatelane/shared";
import { capture, type CaptureInput, writeAuditLog } from "@gatelane/engine";

const api = new Hono<{ Bindings: Env }>();

api.use("*", cors());

api.get("/", (c) => c.json({ name: "gatelane", version: "0.0.0-dev", status: "ok" }));
api.get("/health", (c) => c.json({ status: "ok" }));

// Capture endpoint
api.post("/v1/capture", async (c) => {
  const token = c.req.header("Authorization")?.replace("Bearer ", "");
  if (token !== c.env.GATELANE_CAPTURE_TOKEN) {
    return c.json({ error: "unauthorized" }, 401);
  }

  const body = await c.req.json<CaptureInput & { response: unknown }>();
  const { record } = await capture(c.env, body, async () => body.response);

  await writeAuditLog(c.env, {
    action: "capture",
    resourceType: "capture",
    resourceId: record.id,
    actor: "api",
    detail: { model: record.model, provider: record.provider },
  });

  return c.json({ id: record.id, traceId: record.traceId }, 201);
});

// Datasets
api.get("/v1/datasets", async (c) => {
  const result = await c.env.DB.prepare(
    "SELECT * FROM datasets ORDER BY created_at DESC LIMIT 50",
  ).all();
  return c.json({ datasets: result.results });
});

api.get("/v1/datasets/:id", async (c) => {
  const id = c.req.param("id");
  const dataset = await c.env.DB.prepare("SELECT * FROM datasets WHERE id = ?").bind(id).first();
  if (!dataset) return c.json({ error: "not found" }, 404);
  return c.json(dataset);
});

// Replay runs
api.get("/v1/replay-runs", async (c) => {
  const result = await c.env.DB.prepare(
    "SELECT * FROM replay_runs ORDER BY created_at DESC LIMIT 50",
  ).all();
  return c.json({ runs: result.results });
});

api.get("/v1/replay-runs/:id", async (c) => {
  const id = c.req.param("id");
  const run = await c.env.DB.prepare("SELECT * FROM replay_runs WHERE id = ?").bind(id).first();
  if (!run) return c.json({ error: "not found" }, 404);
  return c.json(run);
});

// Promotions
api.get("/v1/promotions", async (c) => {
  const result = await c.env.DB.prepare(
    "SELECT * FROM promotions ORDER BY created_at DESC LIMIT 50",
  ).all();
  return c.json({ promotions: result.results });
});

api.get("/v1/promotions/:id", async (c) => {
  const id = c.req.param("id");
  const promotion = await c.env.DB.prepare("SELECT * FROM promotions WHERE id = ?").bind(id).first();
  if (!promotion) return c.json({ error: "not found" }, 404);
  return c.json(promotion);
});

// Audit log
api.get("/v1/audit-log", async (c) => {
  const result = await c.env.DB.prepare(
    "SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 100",
  ).all();
  return c.json({ entries: result.results });
});

// Traces
api.get("/v1/traces", async (c) => {
  const result = await c.env.DB.prepare(
    "SELECT * FROM traces ORDER BY created_at DESC LIMIT 50",
  ).all();
  return c.json({ traces: result.results });
});

api.get("/v1/traces/:id", async (c) => {
  const id = c.req.param("id");

  const trace = await c.env.DB.prepare("SELECT * FROM traces WHERE id = ?").bind(id).first();
  if (!trace) return c.json({ error: "not found" }, 404);

  const spans = await c.env.DB.prepare(
    "SELECT * FROM spans WHERE trace_id = ? ORDER BY start_time ASC",
  ).bind(id).all();

  const generations = await c.env.DB.prepare(
    "SELECT * FROM generations WHERE trace_id = ? ORDER BY created_at ASC",
  ).bind(id).all();

  const scores = await c.env.DB.prepare(
    "SELECT * FROM scores WHERE trace_id = ? ORDER BY created_at ASC",
  ).bind(id).all();

  return c.json({
    ...trace,
    spans: spans.results,
    generations: generations.results,
    scores: scores.results,
  });
});

export { api };
