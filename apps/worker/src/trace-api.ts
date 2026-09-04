import { Hono } from "hono";
import type { Env } from "@gatelane/shared";

export const traceApi = new Hono<{ Bindings: Env }>();

traceApi.get("/traces", async (c) => {
  const result = await c.env.DB.prepare(
    "SELECT * FROM traces ORDER BY created_at DESC LIMIT 50",
  ).all();
  return c.json({ traces: result.results });
});

traceApi.get("/traces/:id", async (c) => {
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
