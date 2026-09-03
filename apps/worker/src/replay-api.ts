import { Hono } from "hono";
import type { Env } from "@gatelane/shared";

export const replayApi = new Hono<{ Bindings: Env }>();

replayApi.get("/datasets", async (c) => {
  const result = await c.env.DB.prepare(
    "SELECT * FROM datasets ORDER BY created_at DESC LIMIT 50",
  ).all();
  return c.json({ datasets: result.results });
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
