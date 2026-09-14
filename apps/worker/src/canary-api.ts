import { Hono } from "hono";
import type { Env } from "@gatelane/shared";

export const canaryApi = new Hono<{ Bindings: Env }>();

function requireAuth(c: { req: { header: (name: string) => string | undefined }; env: Env }) {
  const token = c.req.header("Authorization")?.replace("Bearer ", "");
  return token === c.env.GATELANE_CAPTURE_TOKEN;
}

function parseJson(v: unknown, fallback: unknown) {
  if (typeof v !== "string") return v ?? fallback;
  try { return JSON.parse(v); } catch { return fallback; }
}

function rowToCanary(row: Record<string, unknown>) {
  return {
    id: row.id,
    gateRunId: row.gate_run_id,
    candidateRef: row.candidate_ref,
    state: row.state,
    trafficPercent: row.traffic_percent,
    startedAt: row.started_at,
    observationEndsAt: row.observation_ends_at,
    completedAt: row.completed_at,
    autoRollbackRule: parseJson(row.auto_rollback_rule, null),
    observations: parseJson(row.observations, []),
    error: row.error,
    report: parseJson(row.report, {}),
    decision: parseJson(row.decision, {}),
  };
}

// ── Datasets list (supplements the GET /datasets/:id in replay-api) ──

canaryApi.get("/datasets", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM datasets ORDER BY created_at DESC LIMIT ?",
  ).bind(limit).all();
  return c.json({ datasets: results });
});

// ── Canary endpoints ────────────────────────────────────────────────

canaryApi.get("/canaries", async (c) => {
  const state = c.req.query("state");
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);

  let sql = "SELECT * FROM canary_deployments";
  const params: string[] = [];
  if (state) {
    sql += " WHERE state = ?";
    params.push(state);
  }
  sql += " ORDER BY started_at DESC LIMIT ?";
  params.push(String(limit));

  const { results } = await c.env.DB.prepare(sql).bind(...params).all();
  return c.json({ canaries: results.map((r) => rowToCanary(r as Record<string, unknown>)) });
});

canaryApi.get("/canaries/:id", async (c) => {
  const id = c.req.param("id");
  const row = await c.env.DB.prepare(
    "SELECT * FROM canary_deployments WHERE id = ?",
  ).bind(id).first();
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json(rowToCanary(row as Record<string, unknown>));
});

canaryApi.post("/canaries", async (c) => {
  if (!requireAuth(c)) return c.json({ error: "unauthorized" }, 401);

  const body = await c.req.json<{
    gate_run_id: string;
    candidate_ref: string;
    report: unknown;
    decision: unknown;
    initial_traffic_percent?: number;
    observation_window?: string;
  }>();

  const id = `canary-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const now = new Date();
  const trafficPercent = body.initial_traffic_percent ?? 10;

  const windowStr = body.observation_window ?? "24h";
  const windowMatch = windowStr.match(/^(\d+)([smhd])$/);
  const multipliers: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  const windowMs = windowMatch
    ? parseInt(windowMatch[1]!, 10) * (multipliers[windowMatch[2]!] ?? 3_600_000)
    : 86_400_000;
  const observationEndsAt = new Date(now.getTime() + windowMs).toISOString();

  const autoRollbackRule = typeof body.report === "object" && body.report !== null
    ? (body.report as Record<string, unknown>).policy
      ? ((body.report as Record<string, unknown>).policy as Record<string, unknown>).auto_rollback_rule ?? null
      : null
    : null;

  await c.env.DB.prepare(
    `INSERT INTO canary_deployments
       (id, gate_run_id, candidate_ref, state, traffic_percent, started_at,
        observation_ends_at, auto_rollback_rule, observations, report, decision)
     VALUES (?, ?, ?, 'observing', ?, ?, ?, ?, '[]', ?, ?)`,
  ).bind(
    id,
    body.gate_run_id,
    body.candidate_ref,
    trafficPercent,
    now.toISOString(),
    observationEndsAt,
    autoRollbackRule ? JSON.stringify(autoRollbackRule) : null,
    JSON.stringify(body.report),
    JSON.stringify(body.decision),
  ).run();

  const row = await c.env.DB.prepare(
    "SELECT * FROM canary_deployments WHERE id = ?",
  ).bind(id).first();
  return c.json(rowToCanary(row as Record<string, unknown>), 201);
});

canaryApi.post("/canaries/:id/observe", async (c) => {
  if (!requireAuth(c)) return c.json({ error: "unauthorized" }, 401);

  const id = c.req.param("id");
  const row = await c.env.DB.prepare(
    "SELECT * FROM canary_deployments WHERE id = ?",
  ).bind(id).first() as Record<string, unknown> | null;
  if (!row) return c.json({ error: "not found" }, 404);

  const state = row.state as string;
  if (state !== "observing" && state !== "canary") {
    return c.json({ error: `cannot observe: canary in state '${state}'` }, 409);
  }

  const body = await c.req.json<{ metric: string; value: number; baseline: number }>();
  const delta = body.baseline === 0 ? 0 : (body.value - body.baseline) / body.baseline;

  const observations = parseJson(row.observations, []) as unknown[];
  observations.push({
    timestamp: new Date().toISOString(),
    metric: body.metric,
    value: body.value,
    baseline: body.baseline,
    delta,
  });

  const autoRollbackRule = parseJson(row.auto_rollback_rule, null) as { metric_drop?: number } | null;
  let newState = state;
  let error: string | null = null;
  let completedAt: string | null = null;

  if (autoRollbackRule?.metric_drop !== undefined && delta <= -autoRollbackRule.metric_drop) {
    newState = "rolled_back";
    completedAt = new Date().toISOString();
    error = `Auto-rollback triggered: ${body.metric} delta ${delta.toFixed(2)} <= -${autoRollbackRule.metric_drop}`;
  }

  await c.env.DB.prepare(
    `UPDATE canary_deployments
     SET observations = ?, state = ?, error = ?, completed_at = ?
     WHERE id = ?`,
  ).bind(
    JSON.stringify(observations),
    newState,
    error,
    completedAt,
    id,
  ).run();

  const updated = await c.env.DB.prepare(
    "SELECT * FROM canary_deployments WHERE id = ?",
  ).bind(id).first();
  return c.json(rowToCanary(updated as Record<string, unknown>));
});

canaryApi.post("/canaries/:id/advance", async (c) => {
  if (!requireAuth(c)) return c.json({ error: "unauthorized" }, 401);

  const id = c.req.param("id");
  const row = await c.env.DB.prepare(
    "SELECT * FROM canary_deployments WHERE id = ?",
  ).bind(id).first() as Record<string, unknown> | null;
  if (!row) return c.json({ error: "not found" }, 404);

  const state = row.state as string;
  const now = new Date();
  let newState = state;
  let trafficPercent = row.traffic_percent as number;
  let completedAt: string | null = row.completed_at as string | null;
  let advanced = false;

  switch (state) {
    case "pending":
    case "canary":
      newState = "observing";
      advanced = true;
      break;
    case "observing": {
      const endsAt = row.observation_ends_at ? Date.parse(row.observation_ends_at as string) : 0;
      if (now.getTime() >= endsAt) {
        newState = "promoting";
        trafficPercent = 100;
        advanced = true;
      }
      break;
    }
    case "promoting":
      newState = "promoted";
      trafficPercent = 100;
      completedAt = now.toISOString();
      advanced = true;
      break;
  }

  if (!advanced) {
    return c.json({ canary: rowToCanary(row), advanced: false });
  }

  await c.env.DB.prepare(
    `UPDATE canary_deployments
     SET state = ?, traffic_percent = ?, completed_at = ?
     WHERE id = ?`,
  ).bind(newState, trafficPercent, completedAt, id).run();

  const updated = await c.env.DB.prepare(
    "SELECT * FROM canary_deployments WHERE id = ?",
  ).bind(id).first();
  return c.json({ canary: rowToCanary(updated as Record<string, unknown>), advanced: true });
});

canaryApi.post("/canaries/:id/rollback", async (c) => {
  if (!requireAuth(c)) return c.json({ error: "unauthorized" }, 401);

  const id = c.req.param("id");
  const row = await c.env.DB.prepare(
    "SELECT * FROM canary_deployments WHERE id = ?",
  ).bind(id).first() as Record<string, unknown> | null;
  if (!row) return c.json({ error: "not found" }, 404);

  const state = row.state as string;
  if (state === "promoted" || state === "rolled_back") {
    return c.json({ error: `cannot rollback: canary in terminal state '${state}'` }, 409);
  }

  const body = await c.req.json<{ reason: string }>();

  await c.env.DB.prepare(
    `UPDATE canary_deployments
     SET state = 'rolled_back', traffic_percent = 0, completed_at = ?, error = ?
     WHERE id = ?`,
  ).bind(
    new Date().toISOString(),
    `Manual rollback: ${body.reason}`,
    id,
  ).run();

  const updated = await c.env.DB.prepare(
    "SELECT * FROM canary_deployments WHERE id = ?",
  ).bind(id).first();
  return c.json(rowToCanary(updated as Record<string, unknown>));
});
