import { Hono } from "hono";
import type { Env } from "@gatelane/shared";
import {
  tickCanaries,
  recordObservation,
  getCanaryStorage,
  startCanary,
  rollbackCanary,
  advanceCanary,
} from "@lanefoundry/source-prod-slice";

export const canaryApi = new Hono<{ Bindings: Env }>();

function requireAuth(c: { req: { header(name: string): string | undefined }; env: Env }): boolean {
  const token = c.req.header("Authorization")?.replace("Bearer ", "");
  return token === c.env.GATELANE_CAPTURE_TOKEN;
}

canaryApi.get("/canary", async (c) => {
  if (!requireAuth(c)) return c.json({ error: "unauthorized" }, 401);

  const state = c.req.query("state");
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 500);
  const storage = getCanaryStorage();

  const records = await storage.list({
    state: state as Parameters<typeof storage.list>[0] extends { state?: infer S } ? S : never,
    limit,
  });

  return c.json({
    canaries: records.map((r) => ({
      id: r.id,
      gateRunId: r.gateRunId,
      candidateRef: r.candidateRef,
      state: r.state,
      trafficPercent: r.trafficPercent,
      startedAt: r.startedAt,
      observationEndsAt: r.observationEndsAt,
      completedAt: r.completedAt,
      observationCount: r.observations.length,
      error: r.error,
    })),
  });
});

canaryApi.get("/canary/:id", async (c) => {
  if (!requireAuth(c)) return c.json({ error: "unauthorized" }, 401);

  const id = c.req.param("id");
  const storage = getCanaryStorage();
  const record = await storage.read(id);
  if (!record) return c.json({ error: "not found" }, 404);

  return c.json({ canary: record });
});

canaryApi.post("/canary/tick", async (c) => {
  if (!requireAuth(c)) return c.json({ error: "unauthorized" }, 401);

  const changed = await tickCanaries();

  return c.json({
    ticked: changed.length,
    changed: changed.map((r) => ({
      id: r.id,
      candidateRef: r.candidateRef,
      state: r.state,
      trafficPercent: r.trafficPercent,
    })),
  });
});

canaryApi.post("/canary/:id/observe", async (c) => {
  if (!requireAuth(c)) return c.json({ error: "unauthorized" }, 401);

  const id = c.req.param("id");
  const body = await c.req.json<{ metric: string; value: number; baseline: number }>();

  if (!body.metric || typeof body.value !== "number" || typeof body.baseline !== "number") {
    return c.json({ error: "metric (string), value (number), and baseline (number) required" }, 400);
  }

  const result = await recordObservation(id, body.metric, body.value, body.baseline);

  return c.json({
    canaryId: id,
    state: result.record.state,
    advanced: result.advanced,
    observationCount: result.record.observations.length,
    error: result.record.error,
  });
});

canaryApi.post("/canary/:id/rollback", async (c) => {
  if (!requireAuth(c)) return c.json({ error: "unauthorized" }, 401);

  const id = c.req.param("id");
  const body = await c.req.json<{ reason: string }>();

  const result = await rollbackCanary(id, body.reason ?? "manual rollback via API");

  return c.json({
    canaryId: id,
    state: result.record.state,
    error: result.record.error,
  });
});

canaryApi.post("/canary/:id/advance", async (c) => {
  if (!requireAuth(c)) return c.json({ error: "unauthorized" }, 401);

  const id = c.req.param("id");
  const result = await advanceCanary(id);

  return c.json({
    canaryId: id,
    state: result.record.state,
    trafficPercent: result.record.trafficPercent,
    advanced: result.advanced,
  });
});
